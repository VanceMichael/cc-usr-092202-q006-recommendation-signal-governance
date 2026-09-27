// 扶持资格：冻结、恢复与取消；扶持决定附完整理由链，运营可据此解释一次扶持为何成立。
export const STAGE_PROFILES = Object.freeze({
  seedling: Object.freeze({ label: '新手作者', threshold: 5 }),
  growing: Object.freeze({ label: '成长作者', threshold: 12 }),
  established: Object.freeze({ label: '成熟作者', threshold: 25 }),
});

export const NICHE_THRESHOLD_FACTOR = 0.6; // 小众专业赛道门槛系数，避免与大众作者比绝对数
export const MIN_AVG_WATCH_DEPTH = 0.25;
export const MAX_MULTIPLIER = 4;

export const ELIGIBILITY_STATES = Object.freeze(['eligible', 'frozen', 'ineligible']);

export class EligibilityRegistry {
  #records = new Map();

  #key(authorId, cycle) {
    return `${authorId}::${cycle}`;
  }

  stateOf(authorId, cycle) {
    return this.#records.get(this.#key(authorId, cycle))?.state ?? 'eligible';
  }

  #change(authorId, cycle, expected, next, at, reason, flagId = null) {
    const key = this.#key(authorId, cycle);
    const record = this.#records.get(key) ?? { state: 'eligible', history: [] };
    if (!expected.includes(record.state)) throw new Error(`资格状态 ${record.state} 不允许变更为 ${next}`);
    record.state = next;
    record.history.push(Object.freeze({ state: next, at, reason, flag_id: flagId }));
    this.#records.set(key, record);
    return record.state;
  }

  freeze(authorId, cycle, { flagId, at }) {
    return this.#change(authorId, cycle, ['eligible'], 'frozen', at, `风险标记 ${flagId} 待复核，冻结扶持资格`, flagId);
  }

  disqualify(authorId, cycle, { flagId, at }) {
    return this.#change(authorId, cycle, ['frozen'], 'ineligible', at, `风险标记 ${flagId} 复核确认为异常协同`, flagId);
  }

  restore(authorId, cycle, { at, reason }) {
    return this.#change(authorId, cycle, ['frozen', 'ineligible'], 'eligible', at, reason);
  }

  historyOf(authorId, cycle) {
    return [...(this.#records.get(this.#key(authorId, cycle))?.history ?? [])];
  }
}

export function requiredNaturalCount(author) {
  const profile = STAGE_PROFILES[author.stage];
  if (!profile) throw new Error(`未知作者阶段: ${author.stage}`);
  if (!author.niche) return profile.threshold;
  return Math.max(3, Math.ceil(profile.threshold * NICHE_THRESHOLD_FACTOR));
}

const OUTCOME_LABELS = Object.freeze({ granted: '扶持成立', denied: '扶持不成立', deferred: '暂缓决定（资格冻结中）' });

function round2(x) {
  return Number(x.toFixed(2));
}

export function decideSupport({ decisionId, author, summary, eligibilityState, at, decidedBy }) {
  if (!ELIGIBILITY_STATES.includes(eligibilityState)) throw new Error(`未知资格状态: ${eligibilityState}`);
  const required = requiredNaturalCount(author);
  const profile = STAGE_PROFILES[author.stage];
  const trace = [
    `窗口 ${summary.window.start.slice(0, 10)} ~ ${summary.window.end.slice(0, 10)}：推荐共 ${summary.total} 次，剔除同一用户或设备的重放 ${summary.duplicates} 次、已撤销 ${summary.revoked} 次，有效 ${summary.effective} 次，其中自然分享 ${summary.natural_count} 次`,
    `作者阶段 ${profile.label}、赛道 ${author.track}${author.niche ? `（小众专业，门槛按系数 ${NICHE_THRESHOLD_FACTOR} 调整）` : ''}，自然推荐门槛 ${required} 次`,
  ];
  let outcome = 'granted';
  let multiplier = 0;
  if (eligibilityState === 'frozen') {
    outcome = 'deferred';
    trace.push('存在待复核的风险标记，资格冻结中，本次不作扶持决定');
  } else if (eligibilityState === 'ineligible') {
    outcome = 'denied';
    trace.push('异常协同已经人工复核确认，本周期资格取消');
  } else if (summary.natural_count < required) {
    outcome = 'denied';
    trace.push(`有效自然推荐 ${summary.natural_count} 次未达到门槛 ${required} 次`);
  } else if (summary.avg_watch_depth_natural < MIN_AVG_WATCH_DEPTH) {
    outcome = 'denied';
    trace.push(`自然推荐平均观看深度 ${round2(summary.avg_watch_depth_natural)} 低于下限 ${MIN_AVG_WATCH_DEPTH}`);
  } else {
    multiplier = Math.min(MAX_MULTIPLIER, Math.max(1, Math.floor(summary.natural_count / required)));
    trace.push(`自然推荐平均观看深度 ${round2(summary.avg_watch_depth_natural)} 达标，扶持倍数 = min(${MAX_MULTIPLIER}, ⌊${summary.natural_count} / ${required}⌋) = ${multiplier}`);
  }
  trace.push(`结论：${OUTCOME_LABELS[outcome]}`);
  return Object.freeze({
    decision_id: decisionId,
    author_id: author.author_id,
    window: summary.window,
    outcome,
    multiplier,
    required_natural: required,
    actual_natural: summary.natural_count,
    avg_watch_depth_natural: round2(summary.avg_watch_depth_natural),
    eligibility_state: eligibilityState,
    stage: author.stage,
    track: author.track,
    niche: author.niche,
    reason_trace: Object.freeze(trace),
    decided_by: decidedBy,
    decided_at: at,
  });
}

export function explainDecision(decision) {
  const lines = [`扶持决定 ${decision.decision_id}（作者 ${decision.author_id}，决定人 ${decision.decided_by}，时间 ${decision.decided_at}）`];
  decision.reason_trace.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
  return lines.join('\n');
}
