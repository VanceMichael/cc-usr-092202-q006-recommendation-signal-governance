import test from 'node:test';
import assert from 'node:assert/strict';
import { EventLedger } from '../src/events.js';
import { makeWindow, inWindow, summarizeWindow, cycleKeyOf } from '../src/windows.js';

function buildLedger() {
  const ledger = new EventLedger();
  const base = { work_id: 'w-1', work_version: 1, author_id: 'a-1', entry: 'feed', relation: 'stranger', occurred_at: '2026-08-10T10:00:00Z' };
  ledger.ingest({ ...base, event_id: 'e1', channel_kind: 'natural_share', watch_depth: 0.8, user_id: 'u1', device_id: 'd1' });
  ledger.ingest({ ...base, event_id: 'e2', channel_kind: 'natural_share', watch_depth: 0.4, user_id: 'u2', device_id: 'd2', relation: 'friend' });
  ledger.ingest({ ...base, event_id: 'e3', channel_kind: 'campaign_task', watch_depth: 0.1, user_id: 'u3', device_id: 'd3', entry: 'campaign_page' });
  ledger.ingest({ ...base, event_id: 'e4', channel_kind: 'paid_distribution', watch_depth: 0.2, user_id: 'u4', device_id: 'd4', entry: 'paid_placement' });
  ledger.ingest({ ...base, event_id: 'e5', channel_kind: 'natural_share', watch_depth: 0.9, user_id: 'u1', device_id: 'd1', occurred_at: '2026-08-11T10:00:00Z' });
  ledger.ingest({ ...base, event_id: 'e6', channel_kind: 'natural_share', watch_depth: 0.7, user_id: 'u6', device_id: 'd6', occurred_at: '2026-08-30T10:00:00Z' });
  return ledger;
}

test('窗口边界为左闭右开', () => {
  const w = makeWindow('2026-08-24T00:00:00Z', 28);
  assert.equal(w.start, '2026-07-27T00:00:00.000Z');
  assert.equal(inWindow('2026-07-27T00:00:00Z', w), true);
  assert.equal(inWindow('2026-08-24T00:00:00Z', w), false);
  assert.equal(cycleKeyOf(w), '2026-07-27~2026-08-24');
});

test('窗口聚合区分自然、活动与付费，并剔除重放', () => {
  const ledger = buildLedger();
  const w = makeWindow('2026-08-24T00:00:00Z', 28);
  const s = summarizeWindow(ledger.byAuthor('a-1'), w);
  assert.equal(s.total, 5);
  assert.equal(s.duplicates, 1);
  assert.equal(s.effective, 4);
  assert.deepEqual(s.by_channel, { natural_share: 2, campaign_task: 1, paid_distribution: 1 });
  assert.equal(s.natural_count, 2);
  assert.equal(s.inorganic_ratio, 0.5);
  assert.equal(s.distinct_users, 4);
  assert.ok(Math.abs(s.avg_watch_depth_natural - 0.6) < 1e-9);
  assert.equal(s.relation_histogram.friend, 1);
});
