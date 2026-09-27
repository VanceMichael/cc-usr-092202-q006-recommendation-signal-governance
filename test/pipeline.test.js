import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runGovernance, buildOperatorReport, explainGrant } from '../src/index.js';
import { reviewEffect } from '../src/effects.js';
import { createLedger, ingestAll, effectiveEvents } from '../src/ingest.js';

const read = async (name) => JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

async function runAt(asOf = undefined) {
  const timeline = await read('timeline.json');
  const context = await read('context.json');
  return runGovernance(timeline, context, {
    asOf: asOf ?? timeline.decision_as_of,
    windowDays: timeline.window_days,
  });
}

const decisionById = (result, authorId) => result.decisions.find((d) => d.author_id === authorId);

test('端到端：真实小众作者阿青获扶持，付费加热的吉冈不获扶持', async () => {
  const result = await runAt();
  assert.equal(decisionById(result, 'au_qing').eligible, true);
  assert.equal(decisionById(result, 'au_ji').eligible, false);
  const ji = decisionById(result, 'au_ji');
  assert.ok(ji.reasons.some((r) => r.includes('自然推荐数不足')));
  assert.ok(result.supportLog.grants.some((g) => g.author_id === 'au_qing'));
  assert.ok(!result.supportLog.grants.some((g) => g.author_id === 'au_ji'));
});

test('端到端：互助群刷量的老夜被冻结，活动刷量不计自然信号', async () => {
  const result = await runAt();
  const ye = decisionById(result, 'au_ye');
  assert.equal(ye.eligible, false);
  assert.ok(ye.active_violation_rules.includes('device_cluster'));
  assert.ok(ye.active_freeze_case_ids.length > 0);
});

test('端到端：稳定阶段门槛更高，虫鸣不达标', async () => {
  const result = await runAt();
  assert.equal(decisionById(result, 'au_chong').eligible, false);
});

test('端到端：次词先被确认违规冻结、申诉成功后恢复资格，旧判断保留', async () => {
  const result = await runAt();
  const ciCase = result.board.cases.get('au_ci:device_cluster');
  assert.equal(ciCase.status, 'overturned');
  assert.equal(ciCase.decisions.length, 2); // confirm -> appeal_overturn，旧判断未删除
  assert.equal(ciCase.decisions[0].status, 'confirmed_violation');
  assert.equal(ciCase.decisions[1].source, 'appeal');
  assert.equal(decisionById(result, 'au_ci').eligible, true);
  // 冻结记录保留但已解冻
  const freeze = [...result.eligibilityLog.freezes.values()].find((f) => f.author_id === 'au_ci');
  assert.ok(freeze);
  assert.ok(freeze.unfrozen_at);
});

test('端到端：申诉发生前的时点，次词仍处于冻结不获扶持（历史可重放）', async () => {
  const result = await runAt('2026-08-26T00:00:00.000Z');
  assert.equal(decisionById(result, 'au_ci').eligible, false);
});

test('端到端：重放不重复计数（用户维度与设备维度）', async () => {
  const timeline = await read('timeline.json');
  const ledger = createLedger();
  ingestAll(ledger, timeline.recommendation_events);
  const view = effectiveEvents(ledger, timeline.decision_as_of);
  const qingDedup = view.filter((e) => e.author_id === 'au_qing' && e.dedupe_reason);
  assert.equal(qingDedup.length, 1);
  assert.equal(qingDedup[0].dedupe_reason, 'same_user_replay');
  const yeDedup = view.filter((e) => e.author_id === 'au_ye' && e.dedupe_reason);
  assert.ok(yeDedup.length >= 3);
});

test('端到端：扶持解释包含门槛证据与排除口径', async () => {
  const result = await runAt();
  const grant = result.supportLog.grants.find((g) => g.author_id === 'au_qing');
  const text = explainGrant(grant, result.statsByAuthor.get('au_qing'));
  assert.ok(text.includes('达标'));
  assert.ok(text.includes('重放去重'));
  assert.ok(text.includes('撤销'));
  assert.ok(text.includes('冷启动流量包'));
});

test('端到端：效果回看比较扶持前后持续创作与真实受众留存', async () => {
  const result = await runAt();
  const qing = result.effects.find((e) => e.author_id === 'au_qing');
  assert.ok(qing.creation.post_work_count >= qing.creation.pre_work_count);
  assert.equal(qing.creation.continued, true);
  assert.ok(qing.audience_retention.retained_users > 0);
  assert.ok(qing.audience_retention.retention_rate > 0 && qing.audience_retention.retention_rate <= 1);
  // 付费/活动用户不进入真实受众
  const jiGrant = { id: 'g_ji', author_id: 'au_ji', granted_at: '2026-09-01T00:00:00.000Z' };
  const events = effectiveEvents(result.ledger, '2026-09-01T00:00:00.000Z');
  const jiReview = reviewEffect({ grant: jiGrant, works: (await read('timeline.json')).works, events, followupVisits: [] });
  // 吉冈的受众只来自 5 条自然推荐，不含 10 条付费
  assert.equal(jiReview.audience_retention.real_audience_users, 5);
});

test('端到端：报告可完整生成', async () => {
  const result = await runAt();
  const report = buildOperatorReport(result);
  assert.ok(report.includes('扶持为何成立') || report.includes('扶持成立解释'));
  assert.ok(report.includes('效果回看'));
});
