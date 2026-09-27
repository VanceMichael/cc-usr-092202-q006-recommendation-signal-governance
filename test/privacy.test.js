import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessAudit, viewEvent, viewEvents, canViewRelations, deniedAccessCount } from '../src/privacy.js';

const event = {
  id: 'e1', user_id: 'u1', device_id: 'd1', relation_to_author: 'coordinated',
  work_id: 'w1', watch_depth: 0.1, channel: 'organic',
};
const ops = { id: 'staff_ops_01', roles: ['operations'] };
const reviewer = { id: 'staff_risk_01', roles: ['operations', 'risk_reviewer'] };
const auditor = { id: 'staff_audit_01', roles: ['auditor'] };

test('运营人员看不到敏感关系数据，字段被掩码', () => {
  const audit = createAccessAudit();
  const view = viewEvent(event, ops, audit, '2026-09-01T00:00:00.000Z');
  assert.equal(view.relation_to_author, '***redacted***');
  assert.equal(view.user_id, '***');
  assert.equal(view.device_id, '***');
  // 非敏感字段仍可见
  assert.equal(view.watch_depth, 0.1);
  assert.equal(canViewRelations(ops), false);
});

test('反作弊审查员与审计员可查看关系明细', () => {
  const audit = createAccessAudit();
  assert.equal(viewEvent(event, reviewer, audit, '2026-09-01T00:00:00.000Z').relation_to_author, 'coordinated');
  assert.equal(viewEvent(event, auditor, audit, '2026-09-01T00:00:00.000Z').relation_to_author, 'coordinated');
});

test('所有查看尝试（含被拒绝的）都写审计日志', () => {
  const audit = createAccessAudit();
  viewEvents([event, event], ops, audit, '2026-09-01T00:00:00.000Z');
  viewEvents([event], reviewer, audit, '2026-09-01T00:00:00.000Z');
  assert.equal(audit.entries.length, 2);
  assert.deepEqual(audit.entries.map((e) => e.granted), [false, true]);
  assert.equal(deniedAccessCount(audit), 1);
});
