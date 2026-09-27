// 统计窗口：在判定时点回看固定天数，按自然分享/活动任务/付费分发拆分信号。
// 聚合结果只输出数量与比例，不暴露具体用户关系；关系明细由隐私模块控制。
import { withinWindow } from './time.js';

export function authorWindowStats(events, authorId, asOf, windowDays) {
  const scoped = events.filter((event) => (
    event.author_id === authorId && withinWindow(event.ts, asOf, windowDays)
  ));
  const counted = scoped.filter((event) => event.counted_effective);
  const byChannel = { organic: [], campaign: [], paid: [] };
  for (const event of counted) { byChannel[event.channel].push(event); }

  const organic = byChannel.organic;
  const organicDeep = organic.filter((event) => event.watch_depth >= 0.5);
  const organicStrangers = organic.filter((event) => event.relation_to_author === 'stranger');
  const revoked = scoped.filter((event) => event.revoked_effective);
  const deduped = scoped.filter((event) => !event.counted && event.dedupe_reason);

  return {
    author_id: authorId,
    as_of: asOf,
    window_days: windowDays,
    total_counted: counted.length,
    organic_count: organic.length,
    campaign_count: byChannel.campaign.length,
    paid_count: byChannel.paid.length,
    organic_deep_count: organicDeep.length,
    organic_stranger_reach: organicStrangers.length,
    organic_avg_depth: organic.length ? round(avg(organic.map((event) => event.watch_depth))) : null,
    organic_deep_ratio: organic.length ? round(organicDeep.length / organic.length) : null,
    revoked_count: revoked.length,
    replayed_deduped_count: deduped.length,
  };
}

function avg(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
