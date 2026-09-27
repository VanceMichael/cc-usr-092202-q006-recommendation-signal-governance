// 扶持资格：按作者阶段设置门槛；存在生效违规时冻结；申诉成功后恢复。
// 资格状态变更全部留痕，冻结与恢复都是追加事件。
import { activeViolations } from './review.js';

// 阶段门槛取自现有作者阶段资料：冷启动最低、成长中等、稳定最高。
export const STAGE_THRESHOLDS = {
  cold_start: { min_organic: 6, min_organic_deep_ratio: 0.6, min_organic_strangers: 3 },
  growth: { min_organic: 8, min_organic_deep_ratio: 0.65, min_organic_strangers: 5 },
  stable: { min_organic: 12, min_organic_deep_ratio: 0.7, min_organic_strangers: 8 },
};

export function createEligibilityLog() {
  return { freezes: new Map(), events: [] };
}

// 反作弊审查确认违规即冻结扶持资格（风险标记本身不触发冻结）。
export function freezeForViolation(log, authorId, caseId, by, at, reason) {
  const record = {
    author_id: authorId, case_id: caseId, frozen_at: at, frozen_by: by,
    reason, unfrozen_at: null, unfrozen_by: null, unfreeze_reason: null,
  };
  const key = `${authorId}:${caseId}`;
  if (log.freezes.has(key)) { return log.freezes.get(key); }
  log.freezes.set(key, record);
  log.events.push({ at, by, type: 'eligibility_frozen', author_id: authorId, case_id: caseId, reason });
  return record;
}

// 申诉成功后恢复权益：解冻，但冻结记录保留。
export function unfreezeForAppeal(log, authorId, caseId, by, at, reason) {
  const key = `${authorId}:${caseId}`;
  const record = log.freezes.get(key);
  if (!record) { throw new Error(`没有可恢复的冻结记录：${key}`); }
  if (record.unfrozen_at) { return record; }
  record.unfrozen_at = at;
  record.unfrozen_by = by;
  record.unfreeze_reason = reason;
  log.events.push({ at, by, type: 'eligibility_restored', author_id: authorId, case_id: caseId, reason });
  return record;
}

export function activeFreezes(log, authorId, asOf) {
  const asOfTs = Date.parse(asOf);
  return [...log.freezes.values()].filter((record) => {
    if (record.author_id !== authorId) { return false; }
    if (Date.parse(record.frozen_at) > asOfTs) { return false; }
    if (record.unfrozen_at && Date.parse(record.unfrozen_at) <= asOfTs) { return false; }
    return true;
  });
}

function thresholdChecks(stats, stage) {
  const threshold = STAGE_THRESHOLDS[stage];
  if (!threshold) { throw new Error(`未知作者阶段：${stage}`); }
  return [
    { metric: 'organic_count', label: '自然推荐数', actual: stats.organic_count, need: threshold.min_organic, pass: stats.organic_count >= threshold.min_organic },
    { metric: 'organic_deep_ratio', label: '自然推荐深度占比', actual: stats.organic_deep_ratio ?? 0, need: threshold.min_organic_deep_ratio, pass: (stats.organic_deep_ratio ?? 0) >= threshold.min_organic_deep_ratio },
    { metric: 'organic_stranger_reach', label: '触达陌生受众数', actual: stats.organic_stranger_reach, need: threshold.min_organic_strangers, pass: stats.organic_stranger_reach >= threshold.min_organic_strangers },
  ];
}

// 综合判定：门槛通过、无生效违规、无生效冻结 → eligible。
export function evaluateEligibility({ author, stats, board, log, asOf }) {
  const checks = thresholdChecks(stats, author.stage);
  const violations = activeViolations(board, author.id, asOf);
  const freezes = activeFreezes(log, author.id, asOf);
  const reasons = [];
  for (const check of checks) {
    if (!check.pass) { reasons.push(`${check.label}不足（${check.actual} < 门槛 ${check.need}）`); }
  }
  if (violations.length > 0) { reasons.push(`存在生效违规结论：${violations.map((c) => c.rule).join('、')}`); }
  if (freezes.length > 0) { reasons.push(`扶持资格处于冻结：${freezes.map((f) => f.case_id).join('、')}`); }
  return {
    author_id: author.id,
    stage: author.stage,
    as_of: asOf,
    eligible: reasons.length === 0,
    threshold_checks: checks,
    active_violation_rules: violations.map((c) => c.rule),
    active_freeze_case_ids: freezes.map((f) => f.case_id),
    reasons,
  };
}
