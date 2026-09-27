import test from 'node:test';
import assert from 'node:assert/strict';
import { EligibilityRegistry, decideSupport, explainDecision, requiredNaturalCount } from '../src/eligibility.js';

const CYCLE = '2026-07-27~2026-08-24';

function summary(overrides = {}) {
  return {
    window: { start: '2026-07-27T00:00:00.000Z', end: '2026-08-24T00:00:00.000Z', days: 28 },
    total: 20,
    duplicates: 1,
    revoked: 1,
    effective: 18,
    natural_count: 18,
    avg_watch_depth_natural: 0.66,
    ...overrides,
  };
}

const nicheAuthor = { author_id: 'a-niche', stage: 'growing', track: '小众职业创作者', niche: true };
const massAuthor = { author_id: 'a-mass', stage: 'growing', track: '大众剧情创作者', niche: false };

test('小众专业作者门槛按系数下调', () => {
  assert.equal(requiredNaturalCount(massAuthor), 12);
  assert.equal(requiredNaturalCount(nicheAuthor), 8);
  assert.equal(requiredNaturalCount({ ...nicheAuthor, stage: 'seedling' }), 3);
});

test('资格状态机：冻结→取消→申诉恢复，历史完整保留', () => {
  const reg = new EligibilityRegistry();
  assert.equal(reg.stateOf('a-1', CYCLE), 'eligible');
  reg.freeze('a-1', CYCLE, { flagId: 'flag-1', at: '2026-08-25T00:00:00Z' });
  assert.equal(reg.stateOf('a-1', CYCLE), 'frozen');
  assert.throws(() => reg.disqualify('a-2', CYCLE, { flagId: 'flag-2', at: '2026-08-25T00:00:00Z' }), /不允许/);
  reg.disqualify('a-1', CYCLE, { flagId: 'flag-1', at: '2026-08-26T00:00:00Z' });
  assert.equal(reg.stateOf('a-1', CYCLE), 'ineligible');
  reg.restore('a-1', CYCLE, { at: '2026-08-28T00:00:00Z', reason: '申诉成立' });
  assert.equal(reg.stateOf('a-1', CYCLE), 'eligible');
  assert.equal(reg.historyOf('a-1', CYCLE).length, 3);
});

test('扶持决定：达标授予倍数并给出理由链', () => {
  const d = decideSupport({ decisionId: 'd-1', author: nicheAuthor, summary: summary(), eligibilityState: 'eligible', at: '2026-08-25T00:00:00Z', decidedBy: 'ops' });
  assert.equal(d.outcome, 'granted');
  assert.equal(d.multiplier, 2);
  const text = explainDecision(d);
  assert.match(text, /有效 18 次/);
  assert.match(text, /门槛 8 次/);
  assert.match(text, /扶持成立/);
});

test('冻结中暂缓决定，资格取消则拒绝', () => {
  const frozen = decideSupport({ decisionId: 'd-2', author: massAuthor, summary: summary(), eligibilityState: 'frozen', at: '2026-08-25T00:00:00Z', decidedBy: 'ops' });
  assert.equal(frozen.outcome, 'deferred');
  const denied = decideSupport({ decisionId: 'd-3', author: massAuthor, summary: summary(), eligibilityState: 'ineligible', at: '2026-08-25T00:00:00Z', decidedBy: 'ops' });
  assert.equal(denied.outcome, 'denied');
});

test('计量不达标或观看深度不足时拒绝并说明', () => {
  const low = decideSupport({ decisionId: 'd-4', author: massAuthor, summary: summary({ natural_count: 5 }), eligibilityState: 'eligible', at: '2026-08-25T00:00:00Z', decidedBy: 'ops' });
  assert.equal(low.outcome, 'denied');
  assert.match(explainDecision(low), /未达到门槛/);
  const shallow = decideSupport({ decisionId: 'd-5', author: massAuthor, summary: summary({ avg_watch_depth_natural: 0.1 }), eligibilityState: 'eligible', at: '2026-08-25T00:00:00Z', decidedBy: 'ops' });
  assert.equal(shallow.outcome, 'denied');
  assert.match(explainDecision(shallow), /观看深度/);
});
