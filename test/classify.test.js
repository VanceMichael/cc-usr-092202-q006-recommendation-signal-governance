import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRisk } from '../src/classify.js';

const asOf = '2026-09-01T00:00:00.000Z';
const windowDays = 21;

function ev(id, ts, extra = {}) {
  return {
    id, ts, author_id: 'a1', work_id: 'w1', version: 'v1',
    user_id: `u${id}`, device_id: `d${id}`, watch_depth: 0.7,
    channel: 'organic', counted: true, counted_effective: true,
    revoked_effective: false, ...extra,
  };
}

test('数分钟内密集分享触发 burst_share 待复核标记', () => {
  const events = [
    ev('1', '2026-08-20T20:00:00.000Z'),
    ev('2', '2026-08-20T20:01:00.000Z'),
    ev('3', '2026-08-20T20:02:00.000Z'),
    ev('4', '2026-08-20T20:03:00.000Z'),
    ev('5', '2026-08-20T20:04:00.000Z'),
  ];
  const flags = detectRisk(events, 'a1', asOf, windowDays);
  assert.ok(flags.some((f) => f.rule === 'burst_share'));
});

test('同设备多账号、多次推荐触发 device_cluster', () => {
  const events = [
    ev('1', '2026-08-20T20:00:00.000Z', { device_id: 'rd', user_id: 'u1' }),
    ev('2', '2026-08-20T21:00:00.000Z', { device_id: 'rd', user_id: 'u2' }),
    ev('3', '2026-08-21T20:00:00.000Z', { device_id: 'rd', user_id: 'u3' }),
    ev('4', '2026-08-22T20:00:00.000Z', { device_id: 'rd', user_id: 'u4' }),
  ];
  const flags = detectRisk(events, 'a1', asOf, windowDays);
  assert.ok(flags.some((f) => f.rule === 'device_cluster'));
});

test('大量低深度推荐触发 shallow_depth', () => {
  const events = Array.from({ length: 5 }, (_, i) => ev(`e${i}`, `2026-08-${15 + i}T10:00:00.000Z`, { watch_depth: 0.05 }));
  const flags = detectRisk(events, 'a1', asOf, windowDays);
  assert.ok(flags.some((f) => f.rule === 'shallow_depth'));
});

test('正常深度、分散的自然推荐不产生风险标记', () => {
  const events = Array.from({ length: 6 }, (_, i) => ev(`e${i}`, `2026-08-${10 + i * 2}T10:00:00.000Z`));
  assert.deepEqual(detectRisk(events, 'a1', asOf, windowDays), []);
});

test('被去重的重放仍作为协同证据参与密集规则，撤销生效事件不参与', () => {
  const deduped = Array.from({ length: 5 }, (_, i) => ev(
    `e${i}`, `2026-08-20T20:0${i}:00.000Z`, { counted_effective: false, dedupe_reason: 'same_device_replay' },
  ));
  // 重放尝试密集出现 → 仍触发 burst_share（协同证据）
  assert.ok(detectRisk(deduped, 'a1', asOf, windowDays).some((f) => f.rule === 'burst_share'));
  const revoked = Array.from({ length: 5 }, (_, i) => ev(
    `r${i}`, `2026-08-20T20:0${i}:00.000Z`, { revoked_effective: true, counted_effective: false },
  ));
  // 撤销生效的事件不参与任何规则
  assert.deepEqual(detectRisk(revoked, 'a1', asOf, windowDays), []);
});
