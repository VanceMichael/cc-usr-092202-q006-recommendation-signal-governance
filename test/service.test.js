import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GovernanceService } from '../src/service.js';

async function load(name) {
  return JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}

const PRE_END = '2026-08-24T00:00:00Z';
const POST_END = '2026-09-21T00:00:00Z';
const CYCLE = '2026-07-27~2026-08-24';

async function setup() {
  const [context, { authors }, { works }, { events }] = await Promise.all([
    load('context.json'),
    load('authors.json'),
    load('works.json'),
    load('events.json'),
  ]);
  const svc = new GovernanceService({ context, authors, works });
  svc.ingest(events);
  svc.revokeEvent('evt-shen-004', '2026-08-21T00:00:00Z');
  return svc;
}

test('领域约束逐项覆盖，未知约束拒绝启动', async () => {
  const svc = await setup();
  assert.equal(svc.context.domain, 'recommendation-signal-governance');
  const context = await load('context.json');
  assert.throws(() => new GovernanceService({ context: { ...context, constraints: ['未知约束'] } }), /暂无对应治理能力/);
});

test('自然增长作者：无风险标记，扶持成立且可解释', async () => {
  const svc = await setup();
  const { flag, summary } = svc.closeWindow('author-shen', PRE_END, { at: '2026-08-25T00:00:00Z' });
  assert.equal(flag, null);
  assert.equal(summary.natural_count, 18);
  assert.equal(summary.duplicates, 1);
  assert.equal(summary.revoked, 1);
  const d = svc.decideSupport('author-shen', PRE_END, { at: '2026-08-25T01:00:00Z', decidedBy: 'platform-ops-1' });
  assert.equal(d.outcome, 'granted');
  assert.equal(d.multiplier, 1);
  const text = svc.explain(d.decision_id);
  assert.match(text, /自然分享 18 次/);
  assert.match(text, /门槛 15 次/);
  assert.match(text, /扶持成立/);
});

test('小众专业作者：阶段与赛道调整后低绝对值也可成立', async () => {
  const svc = await setup();
  const { flag } = svc.closeWindow('author-gu', PRE_END, { at: '2026-08-25T00:00:00Z' });
  assert.equal(flag, null);
  const d = svc.decideSupport('author-gu', PRE_END, { at: '2026-08-25T01:00:00Z', decidedBy: 'platform-ops-1' });
  assert.equal(d.required_natural, 8);
  assert.equal(d.actual_natural, 9);
  assert.equal(d.outcome, 'granted');
});

test('协同拉票：标记待复核→冻结→确认→申诉翻案→恢复权益但旧判断保留', async () => {
  const svc = await setup();
  const { flag, assessment } = svc.closeWindow('author-huo', PRE_END, { at: '2026-08-25T00:00:00Z' });
  assert.ok(flag);
  assert.equal(flag.status, 'pending_review');
  assert.ok(assessment.score >= 2);
  assert.equal(svc.eligibility.stateOf('author-huo', CYCLE), 'frozen');

  const deferred = svc.decideSupport('author-huo', PRE_END, { at: '2026-08-25T01:00:00Z', decidedBy: 'platform-ops-1' });
  assert.equal(deferred.outcome, 'deferred');

  svc.confirmFlag(flag.flag_id, { reviewer: 'risk-reviewer-1', at: '2026-08-26T00:00:00Z', note: '设备与关系高度集中，确认互助群协同' });
  assert.equal(svc.eligibility.stateOf('author-huo', CYCLE), 'ineligible');
  const denied = svc.decideSupport('author-huo', PRE_END, { at: '2026-08-26T01:00:00Z', decidedBy: 'platform-ops-1' });
  assert.equal(denied.outcome, 'denied');

  svc.openAppeal(flag.flag_id, { appellant: 'author-huo', at: '2026-08-27T00:00:00Z', note: '提交受众来源说明' });
  svc.ruleAppeal(flag.flag_id, { reviewer: 'risk-reviewer-2', at: '2026-08-28T00:00:00Z', outcome: 'overturned', note: '复核证据不足，申诉成立' });
  assert.equal(svc.eligibility.stateOf('author-huo', CYCLE), 'eligible');

  const actions = svc.journal(flag.flag_id).map((e) => e.action);
  assert.deepEqual(actions, ['flag_opened', 'confirmed_abnormal', 'appeal_opened', 'appeal_overturned']);

  // 恢复权益不等于直接扶持：仍按有效自然推荐计量决定
  const after = svc.decideSupport('author-huo', PRE_END, { at: '2026-08-28T01:00:00Z', decidedBy: 'platform-ops-1' });
  assert.equal(after.outcome, 'denied');
  assert.match(svc.explain(after.decision_id), /未达到门槛/);
});

test('效果回看：比较扶持前后的持续创作与真实受众留存', async () => {
  const svc = await setup();
  const report = svc.lookback('author-shen', { preEnd: PRE_END, postEnd: POST_END });
  assert.equal(report.creation.works_pre, 2);
  assert.equal(report.creation.works_post, 2);
  assert.equal(report.creation.sustained, true);
  assert.equal(report.audience.natural_recommenders_pre, 18);
  assert.equal(report.audience.retained, 6);
  assert.equal(report.audience.retention_ratio, 0.3333);
  assert.equal(report.verdict, 'effective');
});

test('敏感关系数据仅供授权角色查看', async () => {
  const svc = await setup();
  const opsView = svc.viewEvents('platform_ops', 'author-huo');
  assert.ok(opsView.every((e) => !('relation' in e)));
  const reviewerView = svc.viewEvents('risk_reviewer', 'author-huo');
  assert.ok(reviewerView.some((e) => e.relation === 'same_group'));
  const opsSummary = svc.viewSummary('platform_ops', 'author-huo', PRE_END);
  assert.equal('relation_histogram' in opsSummary, false);
});
