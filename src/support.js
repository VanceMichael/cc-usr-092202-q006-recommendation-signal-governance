// 扶持决策与解释：运营方需要能解释“一次扶持为何成立”。
// 决策不可变：一旦发放，后续资格变化不改变这一历史决策，只影响之后的决策。
export function createSupportLog() {
  return { grants: [] };
}

export function grantSupport({ author, scenario, decision, grantedAt, grantedBy, package_name }) {
  if (!decision.eligible) {
    throw new Error(`资格未通过，不能发放扶持：${author.id}`);
  }
  const grant = Object.freeze({
    id: `grant_${author.id}_${Date.parse(grantedAt)}`,
    author_id: author.id,
    author_stage: author.stage,
    scenario_id: scenario?.id ?? null,
    scenario_label: scenario?.label ?? null,
    granted_at: grantedAt,
    granted_by: grantedBy,
    package_name,
    // 冻结决策时的依据快照：门槛明细与统计快照，保证事后可解释
    basis: Object.freeze({
      threshold_checks: decision.threshold_checks.map((check) => ({ ...check })),
      active_violation_rules: [...decision.active_violation_rules],
      window: { as_of: decision.as_of, window_days: decision.window_days ?? undefined },
    }),
  });
  return grant;
}

export function recordGrant(log, grant) {
  if (log.grants.some((item) => item.id === grant.id)) { return grant; }
  log.grants.push(grant);
  return grant;
}

// 面向运营的人话解释：每个门槛给证据，明确排除活动/付费/重放信号。
export function explainGrant(grant, stats) {
  const lines = [];
  lines.push(`扶持 ${grant.id} 成立于 ${grant.granted_at}，对象为${grant.author_stage}阶段作者 ${grant.author_id}` +
    `${grant.scenario_label ? `（稀缺场景：${grant.scenario_label}）` : ''}。`);
  for (const check of grant.basis.threshold_checks) {
    lines.push(`- ${check.label}：实际 ${check.actual}，门槛 ${check.need}，${check.pass ? '达标' : '未达标'}。`);
  }
  lines.push(`- 统计窗口 ${stats.window_days} 天（截至 ${stats.as_of}）：计入自然推荐 ${stats.organic_count} 条、` +
    `活动任务 ${stats.campaign_count} 条、付费分发 ${stats.paid_count} 条；` +
    `撤销 ${stats.revoked_count} 条、同用户/设备重放去重 ${stats.replayed_deduped_count} 条，均未计入。`);
  lines.push(`- 生效违规结论：${grant.basis.active_violation_rules.length === 0 ? '无' : grant.basis.active_violation_rules.join('、')}；` +
    '资格未冻结。');
  lines.push('- 结论：自然分享信号达标且无生效反作弊结论，按' +
    `${grant.author_stage}阶段标准发放「${grant.package_name}」。活动任务与付费分发只解释构成，不充当自然质量信号。`);
  return lines.join('\n');
}
