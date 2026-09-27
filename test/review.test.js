import test from 'node:test';
import assert from 'node:assert/strict';
import { ReviewBoard } from '../src/review.js';
import { makeFlag } from '../src/risk.js';

function openBoard() {
  const board = new ReviewBoard();
  const flag = makeFlag({
    flagId: 'flag-1',
    authorId: 'a-1',
    window: { start: '2026-07-27T00:00:00.000Z', end: '2026-08-24T00:00:00.000Z', days: 28 },
    assessment: { score: 3, signals: [] },
    at: '2026-08-25T00:00:00Z',
  });
  board.openFlag(flag);
  return board;
}

test('完整生命周期：标记→确认→申诉→翻案，旧判断全部保留', () => {
  const board = openBoard();
  board.confirm('flag-1', { reviewer: 'reviewer-1', at: '2026-08-26T00:00:00Z', note: '确认互助群协同' });
  assert.equal(board.stateOf('flag-1'), 'confirmed_abnormal');
  board.openAppeal('flag-1', { appellant: 'a-1', at: '2026-08-27T00:00:00Z', note: '提交受众来源说明' });
  board.ruleAppeal('flag-1', { reviewer: 'reviewer-2', at: '2026-08-28T00:00:00Z', outcome: 'overturned', note: '申诉成立' });
  assert.equal(board.stateOf('flag-1'), 'appeal_overturned');
  const journal = board.journal('flag-1');
  assert.deepEqual(journal.map((e) => e.action), ['flag_opened', 'confirmed_abnormal', 'appeal_opened', 'appeal_overturned']);
  assert.ok(journal.some((e) => e.action === 'confirmed_abnormal'));
});

test('复核排除路径', () => {
  const board = openBoard();
  board.clear('flag-1', { reviewer: 'reviewer-1', at: '2026-08-26T00:00:00Z' });
  assert.equal(board.stateOf('flag-1'), 'cleared');
});

test('非法状态跳转被拒绝', () => {
  const board = openBoard();
  assert.throws(() => board.openAppeal('flag-1', { appellant: 'a-1', at: '2026-08-26T00:00:00Z' }), /不允许/);
  assert.throws(() => board.ruleAppeal('flag-1', { reviewer: 'r', at: '2026-08-26T00:00:00Z', outcome: 'upheld' }), /不允许/);
  board.confirm('flag-1', { reviewer: 'r', at: '2026-08-26T00:00:00Z' });
  assert.throws(() => board.confirm('flag-1', { reviewer: 'r', at: '2026-08-27T00:00:00Z' }), /不允许/);
  assert.throws(() => board.clear('flag-1', { reviewer: 'r', at: '2026-08-27T00:00:00Z' }), /不允许/);
});

test('判断日志只增不删且条目不可变', () => {
  const board = openBoard();
  board.clear('flag-1', { reviewer: 'r', at: '2026-08-26T00:00:00Z' });
  const journal = board.journal();
  assert.equal(journal.length, 2);
  assert.equal(Object.isFrozen(journal[0]), true);
  journal.length = 0;
  assert.equal(board.journal().length, 2);
});
