// 推荐事件账本：只追加、不修改，保留事件发生时的作品版本、入口、观看深度、用户关系与撤销状态。
// 幂等：同一事件重复入库只保留首条；同一用户或同一设备对同一作品版本的重放不重复计数。
const REQUIRED_FIELDS = ['id', 'ts', 'work_id', 'version', 'author_id', 'user_id', 'device_id', 'entrypoint', 'watch_depth', 'channel'];

export const CHANNELS = ['organic', 'campaign', 'paid'];

export function createLedger() {
  return {
    events: [], // 已入账事件（含被撤销与被去重的，全部留痕）
    byId: new Map(), // 事件 id -> 事件，保证幂等
    seen: new Map(), // 去重键 work|version|user / work|version|device -> 首个有效事件 id
    duplicates: [], // 被去重的重放记录
  };
}

function dedupeKeys(event) {
  const base = `${event.work_id}|${event.version}`;
  return [`${base}|user|${event.user_id}`, `${base}|device|${event.device_id}`];
}

export function ingestEvent(ledger, raw) {
  for (const field of REQUIRED_FIELDS) {
    if (raw[field] === undefined || raw[field] === null) {
      throw new Error(`推荐事件缺少字段 ${field}: ${raw.id ?? '(无id)'}`);
    }
  }
  if (!CHANNELS.includes(raw.channel)) { throw new Error(`未知入口渠道: ${raw.channel}`); }
  if (typeof raw.watch_depth !== 'number' || raw.watch_depth < 0 || raw.watch_depth > 1) {
    throw new Error(`观看深度越界: ${raw.id}`);
  }
  if (ledger.byId.has(raw.id)) {
    return { event: ledger.byId.get(raw.id), deduplicated: false, alreadyIngested: true };
  }
  // 冻结快照：之后任何流程都不得改写事件发生时的状态
  const event = Object.freeze({
    ...raw,
    revoked: Boolean(raw.revoked),
    revoke_ts: raw.revoke_ts ?? null,
    replay_of: raw.replay_of ?? null,
    counted: false,
    dedupe_reason: null,
  });
  ledger.events.push(event);
  ledger.byId.set(event.id, event);
  // 撤销状态在查询时按判定时点判断；入库时仍正常参与去重，先计入。
  const keys = dedupeKeys(event);
  const hit = keys.find((key) => ledger.seen.has(key));
  if (hit) {
    const firstId = ledger.seen.get(hit);
    const reason = hit.includes('|user|') ? 'same_user_replay' : 'same_device_replay';
    ledger.duplicates.push({ event_id: event.id, first_event_id: firstId, reason });
    return { event: markDeduped(ledger, event, reason), deduplicated: true, alreadyIngested: false };
  }
  for (const key of keys) { ledger.seen.set(key, event.id); }
  return { event: markCounted(ledger, event), deduplicated: false, alreadyIngested: false };
}

// 用替换引用代替原地修改，保持账本语义上的不可变。
function replaceEvent(ledger, event, patch) {
  const next = Object.freeze({ ...event, ...patch });
  ledger.events[ledger.events.indexOf(event)] = next;
  ledger.byId.set(next.id, next);
  return next;
}

function markCounted(ledger, event) {
  return replaceEvent(ledger, event, { counted: true });
}

function markDeduped(ledger, event, reason) {
  return replaceEvent(ledger, event, { dedupe_reason: reason });
}

export function ingestAll(ledger, events) {
  const results = [];
  for (const raw of events) { results.push(ingestEvent(ledger, raw)); }
  return results;
}

// 返回判定时点（含）之前发生的全部事件，并按该时点计算撤销是否生效。
// 事件本身不可变，这里只附加视图字段：revoked_effective / counted_effective。
export function effectiveEvents(ledger, asOf) {
  const asOfTs = Date.parse(asOf);
  return ledger.events
    .filter((event) => Date.parse(event.ts) <= asOfTs)
    .map((event) => {
      const revokedEffective = Boolean(event.revoked && event.revoke_ts && Date.parse(event.revoke_ts) <= asOfTs);
      return { ...event, revoked_effective: revokedEffective, counted_effective: event.counted && !revokedEffective };
    });
}
