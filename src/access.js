// 访问控制：用户关系等敏感数据仅供授权角色查看，其余角色只能看到脱敏投影。
export const ROLES = Object.freeze({
  platform_ops: Object.freeze({ label: '平台运营', relation: false, device: false }),
  rights_examiner: Object.freeze({ label: '品牌与权利审查人员', relation: false, device: false }),
  risk_reviewer: Object.freeze({ label: '风控审查员（授权）', relation: true, device: true }),
  auditor: Object.freeze({ label: '审计员', relation: false, device: false }),
});

export function maskId(id) {
  if (typeof id !== 'string' || id.length <= 4) return '***';
  return `${id.slice(0, 2)}***${id.slice(-2)}`;
}

const PUBLIC_EVENT_FIELDS = Object.freeze([
  'event_id', 'work_id', 'work_version', 'author_id', 'entry', 'channel_kind',
  'watch_depth', 'occurred_at', 'revoked', 'revoked_at', 'duplicate_of',
]);

export function projectEvent(event, role) {
  const perm = ROLES[role];
  if (!perm) throw new Error(`未知访问角色: ${role}`);
  const projected = {};
  for (const field of PUBLIC_EVENT_FIELDS) projected[field] = event[field];
  projected.user_id = maskId(event.user_id);
  projected.device_id = perm.device ? event.device_id : maskId(event.device_id);
  if (perm.relation) projected.relation = event.relation;
  return projected;
}

export function projectSummary(summary, role) {
  const perm = ROLES[role];
  if (!perm) throw new Error(`未知访问角色: ${role}`);
  if (perm.relation) return { ...summary };
  const { relation_histogram, ...rest } = summary;
  return rest;
}
