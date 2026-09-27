import test from 'node:test';
import assert from 'node:assert/strict';
import { projectEvent, projectSummary, maskId } from '../src/access.js';

const event = {
  event_id: 'e1',
  work_id: 'w1',
  work_version: 2,
  author_id: 'a1',
  entry: 'private_chat',
  channel_kind: 'natural_share',
  watch_depth: 0.5,
  occurred_at: '2026-08-10T10:00:00Z',
  revoked: false,
  revoked_at: null,
  duplicate_of: null,
  user_id: 'u-secret-1',
  device_id: 'd-secret-1',
  relation: 'same_group',
};

test('平台运营看不到用户关系，标识被脱敏', () => {
  const v = projectEvent(event, 'platform_ops');
  assert.equal('relation' in v, false);
  assert.notEqual(v.user_id, event.user_id);
  assert.notEqual(v.device_id, event.device_id);
  assert.equal(v.work_version, 2);
});

test('授权的风控审查员可以查看用户关系与设备', () => {
  const v = projectEvent(event, 'risk_reviewer');
  assert.equal(v.relation, 'same_group');
  assert.equal(v.device_id, 'd-secret-1');
});

test('窗口指标中的关系分布同样按角色过滤', () => {
  const summary = { effective: 10, relation_histogram: { friend: 6, stranger: 4 } };
  assert.equal('relation_histogram' in projectSummary(summary, 'platform_ops'), false);
  assert.equal(projectSummary(summary, 'risk_reviewer').relation_histogram.friend, 6);
});

test('未知角色被拒绝', () => {
  assert.throws(() => projectEvent(event, 'nobody'), /未知访问角色/);
  assert.equal(maskId('ab'), '***');
});
