// 效果回看：比较扶持前后的持续创作与真实受众留存。
// “真实受众”只来自被计入的自然推荐用户（活动/付费、重放去重、撤销用户都不算）。
import { DAY_MS, toTs } from './time.js';

export function reviewEffect({ grant, works, events, followupVisits, preDays = 30, postDays = 30, retentionDepth = 0.5 }) {
  const grantedTs = toTs(grant.granted_at);
  const authorWorks = works.filter((work) => work.author_id === grant.author_id);
  const preWorks = authorWorks.filter((work) => {
    const t = toTs(work.publish_ts);
    return t > grantedTs - preDays * DAY_MS && t <= grantedTs;
  });
  const postWorks = authorWorks.filter((work) => {
    const t = toTs(work.publish_ts);
    return t > grantedTs && t <= grantedTs + postDays * DAY_MS;
  });

  // 扶持发生前被自然信号触达的真实受众（去重用户）
  const realAudience = new Set(
    events
      .filter((event) => event.author_id === grant.author_id && (event.counted_effective ?? event.counted) && event.channel === 'organic' && toTs(event.ts) <= grantedTs)
      .map((event) => event.user_id),
  );
  // 扶持后回访：同作者、自然渠道、达到留存深度门槛
  const retained = new Set(
    followupVisits
      .filter((visit) => (
        visit.author_id === grant.author_id
        && realAudience.has(visit.user_id)
        && toTs(visit.ts) > grantedTs
        && toTs(visit.ts) <= grantedTs + postDays * DAY_MS
        && visit.channel === 'organic'
        && visit.watch_depth >= retentionDepth
      ))
      .map((visit) => visit.user_id),
  );

  const rate = realAudience.size === 0 ? null : Math.round((retained.size / realAudience.size) * 1000) / 1000;
  return {
    grant_id: grant.id,
    author_id: grant.author_id,
    granted_at: grant.granted_at,
    window: { pre_days: preDays, post_days: postDays, retention_depth: retentionDepth },
    creation: {
      pre_work_count: preWorks.length,
      post_work_count: postWorks.length,
      delta: postWorks.length - preWorks.length,
      continued: postWorks.length > 0,
      pre_work_ids: preWorks.map((work) => work.id),
      post_work_ids: postWorks.map((work) => work.id),
    },
    audience_retention: {
      real_audience_users: realAudience.size,
      retained_users: retained.size,
      retention_rate: rate,
    },
  };
}

export function formatEffectReview(review) {
  const c = review.creation;
  const r = review.audience_retention;
  return [
    `效果回看（${review.grant_id}，扶持后 ${review.window.post_days} 天）`,
    `- 持续创作：扶持前 ${review.window.pre_days} 天发布 ${c.pre_work_count} 件，扶持后 ${c.post_work_count} 件（${c.delta >= 0 ? '+' : ''}${c.delta}），${c.continued ? '创作在持续' : '扶持后未见新作'}。`,
    `- 真实受众留存：自然推荐受众 ${r.real_audience_users} 人，扶持后回访 ${r.retained_users} 人，留存率 ${r.retention_rate === null ? '无可评估受众' : `${(r.retention_rate * 100).toFixed(1)}%`}。`,
    '- 受众口径已排除活动任务、付费分发、撤销与重放去重用户。',
  ].join('\n');
}
