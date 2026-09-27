// 统计窗口：把台账事件聚合成可解释的窗口指标，供风险模型与扶持决定使用。
export function makeWindow(endISO, days = 28) {
  if (!Number.isInteger(days) || days < 1) throw new Error('窗口天数必须是正整数');
  const end = Date.parse(endISO);
  if (Number.isNaN(end)) throw new Error('窗口结束时间无效');
  return {
    start: new Date(end - days * 86400000).toISOString(),
    end: new Date(end).toISOString(),
    days,
  };
}

export function cycleKeyOf(window) {
  return `${window.start.slice(0, 10)}~${window.end.slice(0, 10)}`;
}

export function inWindow(occurredAt, window) {
  const t = Date.parse(occurredAt);
  return t >= Date.parse(window.start) && t < Date.parse(window.end);
}

export const SHALLOW_WATCH_DEPTH = 0.15;

export function summarizeWindow(events, window) {
  const inside = events.filter((e) => inWindow(e.occurred_at, window));
  const duplicates = inside.filter((e) => e.duplicate_of !== null);
  const revoked = inside.filter((e) => e.duplicate_of === null && e.revoked);
  const effective = inside.filter((e) => e.duplicate_of === null && !e.revoked);

  const byChannel = { natural_share: 0, campaign_task: 0, paid_distribution: 0 };
  const deviceCounts = new Map();
  const hourBuckets = new Map();
  const relationHistogram = {};
  const userIds = new Set();
  let shallow = 0;
  for (const e of effective) {
    byChannel[e.channel_kind] += 1;
    deviceCounts.set(e.device_id, (deviceCounts.get(e.device_id) ?? 0) + 1);
    const hour = e.occurred_at.slice(0, 13);
    hourBuckets.set(hour, (hourBuckets.get(hour) ?? 0) + 1);
    relationHistogram[e.relation] = (relationHistogram[e.relation] ?? 0) + 1;
    userIds.add(e.user_id);
    if (e.watch_depth < SHALLOW_WATCH_DEPTH) shallow += 1;
  }
  const natural = effective.filter((e) => e.channel_kind === 'natural_share');
  const n = effective.length;
  const deviceMax = Math.max(0, ...deviceCounts.values());
  const burstMax = Math.max(0, ...hourBuckets.values());
  const intimate = (relationHistogram.friend ?? 0) + (relationHistogram.same_group ?? 0);

  return {
    window,
    total: inside.length,
    duplicates: duplicates.length,
    revoked: revoked.length,
    effective: n,
    by_channel: byChannel,
    natural_count: byChannel.natural_share,
    natural_ratio: n ? byChannel.natural_share / n : 0,
    inorganic_ratio: n ? (byChannel.campaign_task + byChannel.paid_distribution) / n : 0,
    avg_watch_depth_natural: natural.length ? natural.reduce((s, e) => s + e.watch_depth, 0) / natural.length : 0,
    shallow_ratio: n ? shallow / n : 0,
    distinct_users: userIds.size,
    distinct_devices: deviceCounts.size,
    device_max_share: n ? deviceMax / n : 0,
    relation_concentration: n ? intimate / n : 0,
    burst_max_ratio: n ? burstMax / n : 0,
    relation_histogram: relationHistogram,
  };
}
