// 隐私控制：relation_to_author（以及可据此定位关系的 user_id/device_id）为敏感关系数据，
// 仅授权角色可查看；任何查看尝试都写审计日志，越权访问被拒绝并留痕。
const SENSITIVE_FIELDS = ['relation_to_author', 'user_id', 'device_id'];
const AUTHORIZED_RELATION_ROLES = ['risk_reviewer', 'auditor'];

export function createAccessAudit() {
  return { entries: [] };
}

export function canViewRelations(staff) {
  return staff.roles.some((role) => AUTHORIZED_RELATION_ROLES.includes(role));
}

// 返回脱敏后的事件视图；authorized=false 时敏感字段以固定掩码替代。
export function viewEvent(event, staff, audit, at) {
  const allowed = canViewRelations(staff);
  audit.entries.push({
    at,
    staff_id: staff.id,
    roles: [...staff.roles],
    target: `event:${event.id}`,
    granted: allowed,
  });
  if (allowed) { return { ...event }; }
  const redacted = { ...event };
  for (const field of SENSITIVE_FIELDS) {
    if (field === 'relation_to_author') { redacted[field] = '***redacted***'; }
    else { redacted[field] = '***'; }
  }
  return redacted;
}

// 批量查看：未授权人员只能看到脱敏列表，授权人员才能拿到关系明细。
export function viewEvents(events, staff, audit, at) {
  // 批量只记一条审计，标明数量，避免逐条噪音
  audit.entries.push({
    at,
    staff_id: staff.id,
    roles: [...staff.roles],
    target: `events:count=${events.length}`,
    granted: canViewRelations(staff),
  });
  if (canViewRelations(staff)) { return events.map((event) => ({ ...event })); }
  return events.map((event) => {
    const redacted = { ...event };
    for (const field of SENSITIVE_FIELDS) {
      redacted[field] = field === 'relation_to_author' ? '***redacted***' : '***';
    }
    return redacted;
  });
}

export function deniedAccessCount(audit) {
  return audit.entries.filter((entry) => !entry.granted).length;
}
