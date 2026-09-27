import test from 'node:test';
import assert from 'node:assert/strict';
import { assessWindow, makeFlag } from '../src/risk.js';

function summary(overrides = {}) {
  return {
    window: { start: '2026-07-27T00:00:00.000Z', end: '2026-08-24T00:00:00.000Z', days: 28 },
    effective: 20,
    device_max_share: 0.05,
    relation_concentration: 0.2,
    burst_max_ratio: 0.1,
    shallow_ratio: 0.1,
    inorganic_ratio: 0.1,
    ...overrides,
  };
}

test('干净窗口不触发任何信号', () => {
  const a = assessWindow(summary());
  assert.equal(a.evaluated, true);
  assert.equal(a.score, 0);
  assert.equal(a.signals.length, 0);
});

test('协同特征命中对应信号', () => {
  const a = assessWindow(summary({ device_max_share: 0.5, relation_concentration: 0.9, burst_max_ratio: 0.8, shallow_ratio: 0.95 }));
  assert.equal(a.score, 4);
  assert.deepEqual(a.signals.map((s) => s.key), ['device_cluster', 'relation_concentration', 'burst', 'shallow_watch']);
});

test('样本不足时跳过评估，避免误伤小样本作者', () => {
  const a = assessWindow(summary({ effective: 3, device_max_share: 1 }));
  assert.equal(a.evaluated, false);
  assert.equal(a.score, 0);
});

test('风险模型只能产出待复核标记', () => {
  const a = assessWindow(summary({ device_max_share: 0.9, burst_max_ratio: 0.9 }));
  const flag = makeFlag({ flagId: 'flag-1', authorId: 'a-1', window: summary().window, assessment: a, at: '2026-08-25T00:00:00Z' });
  assert.equal(flag.status, 'pending_review');
  assert.equal(Object.isFrozen(flag), true);
  assert.throws(() => {
    flag.status = 'confirmed_abnormal';
  }, TypeError);
});
