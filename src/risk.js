// 风险模型：只输出「待复核」标记，不作任何资格处置；处置只能由人工复核与申诉流程推进。
export const DEFAULT_THRESHOLDS = Object.freeze({
  minEffective: 5, // 有效推荐过少时不评估，避免误伤小样本作者
  deviceMaxShare: 0.4, // 单一设备贡献占比上限
  relationConcentration: 0.6, // 朋友/同群关系占比上限
  burstMaxRatio: 0.5, // 任意一小时内的推荐占比上限
  shallowRatio: 0.7, // 浅看（观看深度 < 0.15）占比上限
  inorganicRatio: 0.8, // 活动任务 + 付费分发占比上限
  scoreFlag: 2, // 命中信号数达到该值即标记待复核
});

const SIGNALS = Object.freeze([
  { key: 'device_cluster', label: '单一设备集中推荐', pick: (s) => s.device_max_share, max: 'deviceMaxShare' },
  { key: 'relation_concentration', label: '熟人或同群关系集中', pick: (s) => s.relation_concentration, max: 'relationConcentration' },
  { key: 'burst', label: '短时集中爆发', pick: (s) => s.burst_max_ratio, max: 'burstMaxRatio' },
  { key: 'shallow_watch', label: '观看深度普遍过浅', pick: (s) => s.shallow_ratio, max: 'shallowRatio' },
  { key: 'inorganic_channel', label: '活动或付费渠道占比过高', pick: (s) => s.inorganic_ratio, max: 'inorganicRatio' },
]);

export function assessWindow(summary, thresholds = DEFAULT_THRESHOLDS) {
  if (summary.effective < thresholds.minEffective) {
    return { evaluated: false, score: 0, signals: [], note: `有效推荐 ${summary.effective} 次低于评估下限 ${thresholds.minEffective}，跳过风险评估` };
  }
  const signals = [];
  for (const s of SIGNALS) {
    const value = s.pick(summary);
    const threshold = thresholds[s.max];
    if (value > threshold) signals.push({ key: s.key, label: s.label, value: Number(value.toFixed(4)), threshold });
  }
  return { evaluated: true, score: signals.length, signals };
}

// 风险标记状态固定为 pending_review（待复核），对象冻结不可改写。
export function makeFlag({ flagId, authorId, window, assessment, at }) {
  return Object.freeze({
    flag_id: flagId,
    author_id: authorId,
    window,
    score: assessment.score,
    signals: assessment.signals,
    status: 'pending_review',
    created_by: 'risk-model',
    created_at: at,
  });
}
