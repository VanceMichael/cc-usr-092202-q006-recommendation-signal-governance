import test from 'node:test';
import assert from 'node:assert/strict';
import { createLedger, ingestEvent, ingestAll, effectiveEvents } from '../src/ingest.js';

const base = {
  id: 'e1', ts: '2026-08-10T00:00:00.000Z', work_id: 'w1', version: 'v1',
  author_id: 'a1', user_id: 'u1', device_id: 'd1', entrypoint: 'feed',
  watch_depth: 0.7, channel: 'organic',
};

test('重复入库同一事件幂等，不产生第二条', () => {
  const ledger = createLedger();
  const first = ingestEvent(ledger, base);
  const second = ingestEvent(ledger, base);
  assert.equal(first.alreadyIngested, false);
  assert.equal(second.alreadyIngested, true);
  assert.equal(ledger.events.length, 1);
});

test('同一用户对同一作品版本的重放不重复计数', () => {
  const ledger = createLedger();
  ingestEvent(ledger, base);
  const replay = ingestEvent(ledger, { ...base, id: 'e2', device_id: 'd2', replay_of: 'e1' });
  assert.equal(replay.deduplicated, true);
  assert.equal(replay.event.dedupe_reason, 'same_user_replay');
  const [first] = effectiveEvents(ledger, '2026-08-11T00:00:00.000Z');
  assert.equal(first.counted_effective, true);
});

test('同一设备多账号的重放不重复计数', () => {
  const ledger = createLedger();
  ingestEvent(ledger, base);
  const replay = ingestEvent(ledger, { ...base, id: 'e2', user_id: 'u2' });
  assert.equal(replay.event.dedupe_reason, 'same_device_replay');
});

test('不同作品版本可分别计数', () => {
  const ledger = createLedger();
  ingestEvent(ledger, base);
  const nextVersion = ingestEvent(ledger, { ...base, id: 'e2', version: 'v2' });
  assert.equal(nextVersion.deduplicated, false);
});

test('撤销在判定时点前生效、之后不生效，且事件记录仍保留', () => {
  const ledger = createLedger();
  ingestEvent(ledger, { ...base, revoked: true, revoke_ts: '2026-08-20T00:00:00.000Z' });
  const before = effectiveEvents(ledger, '2026-08-15T00:00:00.000Z');
  const after = effectiveEvents(ledger, '2026-08-25T00:00:00.000Z');
  assert.equal(before[0].counted_effective, true);
  assert.equal(after[0].counted_effective, false);
  assert.equal(after[0].revoked_effective, true);
  assert.equal(ledger.events.length, 1); // 撤销不删除记录
});

test('事件快照冻结，事后改入参不影响账本', () => {
  const ledger = createLedger();
  const raw = { ...base };
  ingestEvent(ledger, raw);
  raw.watch_depth = 0.01;
  raw.channel = 'paid';
  const [stored] = ledger.events;
  assert.equal(stored.watch_depth, 0.7);
  assert.equal(stored.channel, 'organic');
  assert.throws(() => { stored.watch_depth = 0.01; }, TypeError);
});

test('非法渠道与越界观看深度被拒绝', () => {
  const ledger = createLedger();
  assert.throws(() => ingestEvent(ledger, { ...base, channel: 'brigade' }));
  assert.throws(() => ingestEvent(ledger, { ...base, id: 'x', watch_depth: 1.5 }));
});

test('批量入库后按时点过滤未来事件', () => {
  const ledger = createLedger();
  ingestAll(ledger, [
    base,
    { ...base, id: 'future', ts: '2026-09-10T00:00:00.000Z' },
  ]);
  const view = effectiveEvents(ledger, '2026-09-01T00:00:00.000Z');
  assert.deepEqual(view.map((e) => e.id), ['e1']);
});
