// 人工复核与申诉：判断日志只增不删，申诉成功恢复权益但保留旧判断。
const TRANSITIONS = Object.freeze({
  flag_opened: { from: null, to: 'pending_review' },
  confirmed_abnormal: { from: ['pending_review'], to: 'confirmed_abnormal' },
  cleared: { from: ['pending_review'], to: 'cleared' },
  appeal_opened: { from: ['confirmed_abnormal'], to: 'appeal_pending' },
  appeal_upheld: { from: ['appeal_pending'], to: 'appeal_upheld' },
  appeal_overturned: { from: ['appeal_pending'], to: 'appeal_overturned' },
});

export class ReviewBoard {
  #flags = new Map();
  #journal = [];

  #append(flagId, action, actor, at, note) {
    const entry = Object.freeze({ seq: this.#journal.length + 1, flag_id: flagId, action, actor, at, note });
    this.#journal.push(entry);
    return entry;
  }

  openFlag(flag) {
    if (flag.status !== 'pending_review') throw new Error('风险标记只能以待复核状态进入复核流程');
    if (this.#flags.has(flag.flag_id)) throw new Error(`风险标记重复: ${flag.flag_id}`);
    this.#flags.set(flag.flag_id, { flag, state: 'pending_review' });
    this.#append(flag.flag_id, 'flag_opened', flag.created_by, flag.created_at, `风险评分 ${flag.score}`);
    return flag;
  }

  #transition(flagId, action, actor, at, note = '') {
    const record = this.#flags.get(flagId);
    if (!record) throw new Error(`风险标记不存在: ${flagId}`);
    const rule = TRANSITIONS[action];
    if (!rule.from || !rule.from.includes(record.state)) {
      throw new Error(`状态 ${record.state} 不允许执行 ${action}`);
    }
    record.state = rule.to;
    return this.#append(flagId, action, actor, at, note);
  }

  confirm(flagId, { reviewer, at, note = '' }) {
    return this.#transition(flagId, 'confirmed_abnormal', reviewer, at, note);
  }

  clear(flagId, { reviewer, at, note = '' }) {
    return this.#transition(flagId, 'cleared', reviewer, at, note);
  }

  openAppeal(flagId, { appellant, at, note = '' }) {
    return this.#transition(flagId, 'appeal_opened', appellant, at, note);
  }

  ruleAppeal(flagId, { reviewer, at, outcome, note = '' }) {
    if (outcome !== 'upheld' && outcome !== 'overturned') throw new Error('申诉裁定只能是 upheld 或 overturned');
    return this.#transition(flagId, outcome === 'upheld' ? 'appeal_upheld' : 'appeal_overturned', reviewer, at, note);
  }

  stateOf(flagId) {
    const record = this.#flags.get(flagId);
    if (!record) throw new Error(`风险标记不存在: ${flagId}`);
    return record.state;
  }

  // 只提供只读视图，没有删除或改写入口。
  journal(flagId = null) {
    return this.#journal.filter((e) => flagId === null || e.flag_id === flagId);
  }
}
