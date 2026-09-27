import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createReviewBoard, openCasesFromFlags, confirmCase, overturnCase,
  appealOverturn, activeViolations, pendingCases, CASE_STATUS,
} from '../src/review.js';
import {
  createEligibilityLog, freezeForViolation, unfreezeForAppeal,
  activeFreezes, evaluateEligibility,
} from '../src/eligibility.js';

const flag = (authorId = 'a1', rule = 'burst_share') => ({ author_id: authorId, rule, label: 'x', event_ids: [], detail: 'x' });

test('风险模型只产生待复核案件，未确认前不算违规', () => {
  const board = createReviewBoard();
  openCasesFromFlags(board, [flag()], 'risk-model', '2026-08-23T00:00:00.000Z');
  assert.equal(pendingCases(board).length, 1);
  assert.deepEqual(activeViolations(board, 'a1', '2026-08-24T00:00:00.000Z'), []);
});

test('确认违规后生效，冻结资格', () => {
  const board = createReviewBoard();
  const log = createEligibilityLog();
  openCasesFromFlags(board, [flag()], 'risk-model', '2026-08-23T00:00:00.000Z');
  const [caseRecord] = pendingCases(board);
  confirmCase(board, caseRecord.id, 'staff_risk_01', '2026-08-25T00:00:00.000Z', '确认互助群刷量');
  freezeForViolation(log, 'a1', caseRecord.id, 'staff_risk_01', '2026-08-25T00:00:00.000Z', '确认互助群刷量');
  assert.equal(activeViolations(board, 'a1', '2026-08-26T00:00:00.000Z').length, 1);
  assert.equal(activeFreezes(log, 'a1', '2026-08-26T00:00:00.000Z').length, 1);
});

test('申诉成功恢复权益，但旧判断不删除', () => {
  const board = createReviewBoard();
  const log = createEligibilityLog();
  openCasesFromFlags(board, [flag()], 'risk-model', '2026-08-23T00:00:00.000Z');
  const [caseRecord] = pendingCases(board);
  confirmCase(board, caseRecord.id, 's1', '2026-08-25T00:00:00.000Z', '确认');
  freezeForViolation(log, 'a1', caseRecord.id, 's1', '2026-08-25T00:00:00.000Z', '确认');
  appealOverturn(board, caseRecord.id, 's2', '2026-08-28T00:00:00.000Z', '申诉成立，作者未参与');
  unfreezeForAppeal(log, 'a1', caseRecord.id, 's2', '2026-08-28T00:00:00.000Z', '申诉成立');

  assert.equal(board.cases.get('a1:burst_share').status, CASE_STATUS.OVERTURNED);
  assert.equal(activeViolations(board, 'a1', '2026-08-29T00:00:00.000Z').length, 0);
  assert.equal(activeFreezes(log, 'a1', '2026-08-29T00:00:00.000Z').length, 0);
  // 旧判断仍在决定历史中
  const decisions = board.cases.get('a1:burst_share').decisions;
  assert.deepEqual(decisions.map((d) => d.status), [CASE_STATUS.CONFIRMED, CASE_STATUS.OVERTURNED]);
  assert.equal(decisions[1].source, 'appeal');
  // 冻结记录保留，含解冻信息
  const freeze = [...log.freezes.values()][0];
  assert.equal(freeze.unfrozen_at, '2026-08-28T00:00:00.000Z');
});

test('未确认案件不能申诉；已终局案件不能再次确认', () => {
  const board = createReviewBoard();
  openCasesFromFlags(board, [flag()], 'risk-model', '2026-08-23T00:00:00.000Z');
  const [caseRecord] = pendingCases(board);
  assert.throws(() => appealOverturn(board, caseRecord.id, 's', '2026-08-24T00:00:00.000Z', 'x'));
  overturnCase(board, caseRecord.id, 's', '2026-08-24T00:00:00.000Z', '误报');
  assert.throws(() => confirmCase(board, caseRecord.id, 's', '2026-08-25T00:00:00.000Z', 'x'));
});

test('违规与冻结按时间点生效，支持历史回看', () => {
  const board = createReviewBoard();
  const log = createEligibilityLog();
  openCasesFromFlags(board, [flag()], 'risk-model', '2026-08-23T00:00:00.000Z');
  const [caseRecord] = pendingCases(board);
  confirmCase(board, caseRecord.id, 's1', '2026-08-25T00:00:00.000Z', '确认');
  freezeForViolation(log, 'a1', caseRecord.id, 's1', '2026-08-25T00:00:00.000Z', '确认');
  // 确认前的时点：无违规无冻结
  assert.equal(activeViolations(board, 'a1', '2026-08-24T00:00:00.000Z').length, 0);
  assert.equal(activeFreezes(log, 'a1', '2026-08-24T00:00:00.000Z').length, 0);
});

test('综合资格：门槛达标但存在生效冻结则不通过', () => {
  const board = createReviewBoard();
  const log = createEligibilityLog();
  openCasesFromFlags(board, [flag('a1', 'device_cluster')], 'risk-model', '2026-08-23T00:00:00.000Z');
  const [caseRecord] = pendingCases(board);
  confirmCase(board, caseRecord.id, 's1', '2026-08-25T00:00:00.000Z', '确认');
  freezeForViolation(log, 'a1', caseRecord.id, 's1', '2026-08-25T00:00:00.000Z', '确认');
  const stats = {
    organic_count: 10, organic_deep_ratio: 0.9, organic_stranger_reach: 8,
  };
  const decision = evaluateEligibility({ author: { id: 'a1', stage: 'cold_start' }, stats, board, log, asOf: '2026-08-26T00:00:00.000Z' });
  assert.equal(decision.eligible, false);
  assert.deepEqual(decision.active_freeze_case_ids, [caseRecord.id]);
});
