// 推荐事件台账：校验、去重与撤销，保留推荐发生时的完整上下文。
export const ENTRY_POINTS = Object.freeze(['feed', 'share_link', 'campaign_page', 'private_chat', 'paid_placement']);
export const CHANNEL_KINDS = Object.freeze(['natural_share', 'campaign_task', 'paid_distribution']);
export const RELATIONS = Object.freeze(['follower', 'friend', 'same_group', 'stranger']);

const REQUIRED_STRINGS = ['event_id', 'work_id', 'author_id', 'user_id', 'device_id'];

function assertString(value, field) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`推荐事件字段 ${field} 缺失或无效`);
}

export function validateEvent(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('推荐事件必须是对象');
  for (const field of REQUIRED_STRINGS) assertString(raw[field], field);
  if (!Number.isInteger(raw.work_version) || raw.work_version < 1) throw new Error('推荐事件必须保留推荐发生时的作品版本（正整数）');
  if (!ENTRY_POINTS.includes(raw.entry)) throw new Error(`未知推荐入口: ${raw.entry}`);
  if (!CHANNEL_KINDS.includes(raw.channel_kind)) throw new Error(`未知推荐渠道: ${raw.channel_kind}`);
  if (!RELATIONS.includes(raw.relation)) throw new Error(`未知用户关系: ${raw.relation}`);
  if (typeof raw.watch_depth !== 'number' || raw.watch_depth < 0 || raw.watch_depth > 1) throw new Error('观看深度必须是 0~1 之间的小数');
  if (typeof raw.occurred_at !== 'string' || Number.isNaN(Date.parse(raw.occurred_at))) throw new Error('推荐时间无效');
  return {
    event_id: raw.event_id,
    work_id: raw.work_id,
    work_version: raw.work_version,
    author_id: raw.author_id,
    entry: raw.entry,
    channel_kind: raw.channel_kind,
    watch_depth: raw.watch_depth,
    user_id: raw.user_id,
    device_id: raw.device_id,
    relation: raw.relation,
    occurred_at: new Date(raw.occurred_at).toISOString(),
  };
}

export class EventLedger {
  #events = [];
  #byId = new Map();
  #firstByUserWork = new Map();
  #firstByDeviceWork = new Map();

  // 同一用户或同一设备对同一作品的重放只计第一次；撤销后同源重放也不再计数。
  // 去重以入库顺序为准，重放事件仍完整保留（含新的作品版本），仅标记 duplicate_of。
  ingest(raw) {
    const event = validateEvent(raw);
    if (this.#byId.has(event.event_id)) throw new Error(`推荐事件标识重复: ${event.event_id}`);
    const userKey = `${event.user_id}::${event.work_id}`;
    const deviceKey = `${event.device_id}::${event.work_id}`;
    const duplicateOf = this.#firstByUserWork.get(userKey) ?? this.#firstByDeviceWork.get(deviceKey) ?? null;
    const stored = Object.freeze({ ...event, duplicate_of: duplicateOf, revoked: false, revoked_at: null });
    this.#events.push(stored);
    this.#byId.set(stored.event_id, stored);
    if (duplicateOf === null) {
      this.#firstByUserWork.set(userKey, stored.event_id);
      this.#firstByDeviceWork.set(deviceKey, stored.event_id);
    }
    return stored;
  }

  // 撤销只改状态不删记录，撤销时间不得早于推荐时间。
  revoke(eventId, at) {
    const event = this.#byId.get(eventId);
    if (!event) throw new Error(`推荐事件不存在: ${eventId}`);
    if (event.revoked) throw new Error(`推荐事件已撤销: ${eventId}`);
    if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) throw new Error('撤销时间无效');
    if (Date.parse(at) < Date.parse(event.occurred_at)) throw new Error('撤销时间早于推荐时间');
    const updated = Object.freeze({ ...event, revoked: true, revoked_at: new Date(at).toISOString() });
    this.#events[this.#events.indexOf(event)] = updated;
    this.#byId.set(eventId, updated);
    return updated;
  }

  get(eventId) {
    return this.#byId.get(eventId) ?? null;
  }

  all() {
    return [...this.#events];
  }

  byAuthor(authorId) {
    return this.#events.filter((e) => e.author_id === authorId);
  }

  effective(authorId) {
    return this.#events.filter((e) => e.author_id === authorId && e.duplicate_of === null && !e.revoked);
  }
}
