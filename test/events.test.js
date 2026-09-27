import test from 'node:test';
import assert from 'node:assert/strict';
import { EventLedger, validateEvent } from '../src/events.js';

let seq = 0;
function evt(overrides = {}) {
  seq += 1;
  return {
    event_id: `evt-t-${seq}`,
    work_id: 'w-1',
    work_version: 1,
    author_id: 'author-t',
    entry: 'feed',
    channel_kind: 'natural_share',
    watch_depth: 0.6,
    user_id: `u-t-${seq}`,
    device_id: `d-t-${seq}`,
    relation: 'stranger',
    occurred_at: '2026-08-10T10:00:00Z',
    ...overrides,
  };
}

test('合法事件通过校验并保留作品版本', () => {
  const e = validateEvent(evt({ work_version: 3 }));
  assert.equal(e.work_version, 3);
});

test('缺少必要字段或枚举非法时拒绝', () => {
  assert.throws(() => validateEvent(evt({ user_id: '' })), /user_id/);
  assert.throws(() => validateEvent(evt({ entry: 'unknown' })), /入口/);
  assert.throws(() => validateEvent(evt({ channel_kind: 'botted' })), /渠道/);
  assert.throws(() => validateEvent(evt({ relation: 'colleague' })), /关系/);
  assert.throws(() => validateEvent(evt({ watch_depth: 1.5 })), /观看深度/);
  assert.throws(() => validateEvent(evt({ work_version: 0 })), /作品版本/);
  assert.throws(() => validateEvent(evt({ occurred_at: 'not-a-date' })), /时间/);
});

test('同一用户对同一作品的重放不重复计数', () => {
  const ledger = new EventLedger();
  const first = ledger.ingest(evt({ user_id: 'u-a', device_id: 'd-a', occurred_at: '2026-08-10T10:00:00Z' }));
  const replay = ledger.ingest(evt({ user_id: 'u-a', device_id: 'd-b', work_version: 2, occurred_at: '2026-08-11T10:00:00Z' }));
  assert.equal(first.duplicate_of, null);
  assert.equal(replay.duplicate_of, first.event_id);
  assert.equal(ledger.effective('author-t').length, 1);
  // 重放事件的完整上下文（含新作品版本）仍保留在台账中
  assert.equal(ledger.get(replay.event_id).work_version, 2);
});

test('同一设备不同用户对同一作品也只计一次', () => {
  const ledger = new EventLedger();
  ledger.ingest(evt({ user_id: 'u-a', device_id: 'd-shared' }));
  const second = ledger.ingest(evt({ user_id: 'u-b', device_id: 'd-shared', occurred_at: '2026-08-10T11:00:00Z' }));
  assert.notEqual(second.duplicate_of, null);
  assert.equal(ledger.effective('author-t').length, 1);
});

test('不同作品之间互不影响', () => {
  const ledger = new EventLedger();
  ledger.ingest(evt({ user_id: 'u-a', device_id: 'd-a', work_id: 'w-1' }));
  ledger.ingest(evt({ user_id: 'u-a', device_id: 'd-a', work_id: 'w-2' }));
  assert.equal(ledger.effective('author-t').length, 2);
});

test('撤销保留记录但不计入有效推荐，同源重放也不再计数', () => {
  const ledger = new EventLedger();
  const first = ledger.ingest(evt({ user_id: 'u-a', device_id: 'd-a' }));
  ledger.ingest(evt({ user_id: 'u-a', device_id: 'd-a', occurred_at: '2026-08-12T10:00:00Z' }));
  const revoked = ledger.revoke(first.event_id, '2026-08-13T00:00:00Z');
  assert.equal(revoked.revoked, true);
  assert.equal(ledger.all().length, 2);
  assert.equal(ledger.effective('author-t').length, 0);
  assert.throws(() => ledger.revoke(first.event_id, '2026-08-14T00:00:00Z'), /已撤销/);
  assert.throws(() => ledger.revoke('evt-x', '2026-08-13T00:00:00Z'), /不存在/);
});
