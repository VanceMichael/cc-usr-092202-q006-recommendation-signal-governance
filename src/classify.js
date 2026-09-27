// 信号分类与风险标记：区分自然分享、活动任务、付费分发与异常协同。
// 风险模型只产出“待复核”标记，不直接扣减、不直接处罚。
import { withinWindow } from './time.js';

export const RISK_RULES = {
  burst_share: { min_events: 5, span_ms: 10 * 60 * 1000, label: '短时密集分享' },
  device_cluster: { min_users_per_device: 2, min_events: 3, label: '同设备多账号' },
  shallow_depth: { max_depth: 0.2, min_events: 5, label: '观看深度异常偏低' },
};

// 在判定窗口内对单作者的有效事件跑规则，返回待复核标记列表。
// 协同类规则（密集分享、设备聚集）连被去重的重复尝试一起看——重复尝试本身就是协同证据；
// 低深度规则只衡量被计入的自然信号，活动/付费渠道已单独计量、不充当质量信号。
export function detectRisk(events, authorId, asOf, windowDays) {
  const scoped = events.filter((event) => (
    event.author_id === authorId && !event.revoked_effective && withinWindow(event.ts, asOf, windowDays)
  ));
  const countedOrganic = scoped.filter((event) => event.counted_effective && event.channel === 'organic');
  const flags = [];
  flags.push(...detectBurst(scoped, authorId));
  flags.push(...detectDeviceCluster(scoped, authorId));
  flags.push(...detectShallowDepth(countedOrganic, authorId));
  return flags;
}

function detectBurst(events, authorId) {
  const rule = RISK_RULES.burst_share;
  const sorted = [...events].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const flags = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && Date.parse(sorted[j].ts) - Date.parse(sorted[i].ts) <= rule.span_ms) { j += 1; }
    if (j - i >= rule.min_events) {
      flags.push({
        author_id: authorId,
        rule: 'burst_share',
        label: rule.label,
        event_ids: sorted.slice(i, j).map((event) => event.id),
        detail: `${rule.span_ms / 60000} 分钟内 ${j - i} 次推荐`,
      });
      i = j;
    } else {
      i += 1;
    }
  }
  return flags;
}

function detectDeviceCluster(events, authorId) {
  const rule = RISK_RULES.device_cluster;
  const byDevice = new Map();
  for (const event of events) {
    if (!byDevice.has(event.device_id)) { byDevice.set(event.device_id, []); }
    byDevice.get(event.device_id).push(event);
  }
  const flags = [];
  for (const [deviceId, list] of byDevice) {
    const users = new Set(list.map((event) => event.user_id));
    if (users.size >= rule.min_users_per_device && list.length >= rule.min_events) {
      flags.push({
        author_id: authorId,
        rule: 'device_cluster',
        label: rule.label,
        event_ids: list.map((event) => event.id),
        detail: `设备 ${deviceId} 关联 ${users.size} 个账号、${list.length} 次推荐`,
      });
    }
  }
  return flags;
}

function detectShallowDepth(events, authorId) {
  const rule = RISK_RULES.shallow_depth;
  const shallow = events.filter((event) => event.watch_depth < rule.max_depth);
  if (shallow.length < rule.min_events) { return []; }
  return [{
    author_id: authorId,
    rule: 'shallow_depth',
    label: rule.label,
    event_ids: shallow.map((event) => event.id),
    detail: `${shallow.length} 次推荐观看深度低于 ${rule.max_depth}`,
  }];
}
