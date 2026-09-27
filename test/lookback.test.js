import test from 'node:test';
import assert from 'node:assert/strict';
import { compareEffect } from '../src/lookback.js';

test('留存与持续创作达标判定为有效', () => {
  const r = compareEffect({
    preEvents: [{ user_id: 'u1' }, { user_id: 'u2' }, { user_id: 'u3' }],
    postEvents: [{ user_id: 'u1' }, { user_id: 'u9' }],
    preWorks: [{ work_id: 'w1' }, { work_id: 'w2' }],
    postWorks: [{ work_id: 'w3' }, { work_id: 'w4' }],
  });
  assert.equal(r.audience.retention_ratio, 0.3333);
  assert.equal(r.audience.retained, 1);
  assert.equal(r.audience.new_post, 1);
  assert.equal(r.creation.sustained, true);
  assert.equal(r.verdict, 'effective');
});

test('受众流失且停更判定为无效', () => {
  const r = compareEffect({
    preEvents: [{ user_id: 'u1' }, { user_id: 'u2' }],
    postEvents: [],
    preWorks: [{ work_id: 'w1' }],
    postWorks: [],
  });
  assert.equal(r.verdict, 'ineffective');
  assert.ok(r.notes.length > 0);
});

test('扶持前无自然受众时留存记为空', () => {
  const r = compareEffect({ preEvents: [], postEvents: [{ user_id: 'u1' }], preWorks: [], postWorks: [{ work_id: 'w1' }] });
  assert.equal(r.audience.retention_ratio, null);
  assert.equal(r.verdict, 'neutral');
});
