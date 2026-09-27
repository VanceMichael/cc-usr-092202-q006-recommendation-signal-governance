// 推荐信号治理服务：以领域资料为约束，串联计量、风控、复核、资格与回看。
import { parseRecords } from './records.js';
import { EventLedger } from './events.js';
import { makeWindow, cycleKeyOf, inWindow, summarizeWindow } from './windows.js';
import { assessWindow, makeFlag, DEFAULT_THRESHOLDS } from './risk.js';
import { ReviewBoard } from './review.js';
import { EligibilityRegistry, decideSupport, explainDecision } from './eligibility.js';
import { compareEffect } from './lookback.js';
import { projectEvent, projectSummary } from './access.js';

// 领域资料中声明的约束必须逐项落到治理能力，缺项直接拒绝启动。
const CONSTRAINT_CAPABILITIES = Object.freeze({
  推荐事件计量: 'windows',
  异常协同识别: 'risk',
  扶持资格审查: 'eligibility',
  效果归因: 'lookback',
});

export class GovernanceService {
  constructor({ context, authors = [], works = [], thresholds = DEFAULT_THRESHOLDS }) {
    this.context = typeof context === 'string' ? parseRecords(context) : parseRecords(JSON.stringify(context));
    for (const constraint of this.context.constraints) {
      if (!CONSTRAINT_CAPABILITIES[constraint]) throw new Error(`领域约束「${constraint}」暂无对应治理能力`);
    }
    this.authors = new Map(authors.map((a) => [a.author_id, Object.freeze({ ...a })]));
    this.works = works.map((w) => Object.freeze({ ...w }));
    this.thresholds = thresholds;
    this.ledger = new EventLedger();
    this.reviewBoard = new ReviewBoard();
    this.eligibility = new EligibilityRegistry();
    this.flags = new Map();
    this.decisions = new Map();
    this.flagSeq = 0;
    this.decisionSeq = 0;
  }

  ingest(events) {
    return events.map((e) => this.ledger.ingest(e));
  }

  revokeEvent(eventId, at) {
    return this.ledger.revoke(eventId, at);
  }

  // 关闭统计窗口：聚合指标并运行风险模型；命中即开待复核标记并自动冻结当期资格。
  closeWindow(authorId, endISO, { days = 28, at } = {}) {
    const window = makeWindow(endISO, days);
    const summary = summarizeWindow(this.ledger.byAuthor(authorId), window);
    const assessment = assessWindow(summary, this.thresholds);
    let flag = null;
    if (assessment.evaluated && assessment.score >= this.thresholds.scoreFlag) {
      flag = makeFlag({ flagId: `flag-${++this.flagSeq}`, authorId, window, assessment, at: at ?? window.end });
      this.reviewBoard.openFlag(flag);
      const cycle = cycleKeyOf(window);
      this.flags.set(flag.flag_id, { flag, authorId, cycle });
      if (this.eligibility.stateOf(authorId, cycle) === 'eligible') {
        this.eligibility.freeze(authorId, cycle, { flagId: flag.flag_id, at: flag.created_at });
      }
    }
    return { window, summary, assessment, flag };
  }

  #flagRecord(flagId) {
    const record = this.flags.get(flagId);
    if (!record) throw new Error(`风险标记不存在: ${flagId}`);
    return record;
  }

  confirmFlag(flagId, { reviewer, at, note = '' }) {
    const entry = this.reviewBoard.confirm(flagId, { reviewer, at, note });
    const { authorId, cycle } = this.#flagRecord(flagId);
    this.eligibility.disqualify(authorId, cycle, { flagId, at });
    return entry;
  }

  clearFlag(flagId, { reviewer, at, note = '' }) {
    const entry = this.reviewBoard.clear(flagId, { reviewer, at, note });
    const { authorId, cycle } = this.#flagRecord(flagId);
    this.eligibility.restore(authorId, cycle, { at, reason: `风险标记 ${flagId} 复核排除，恢复扶持资格` });
    return entry;
  }

  openAppeal(flagId, { appellant, at, note = '' }) {
    return this.reviewBoard.openAppeal(flagId, { appellant, at, note });
  }

  ruleAppeal(flagId, { reviewer, at, outcome, note = '' }) {
    const entry = this.reviewBoard.ruleAppeal(flagId, { reviewer, at, outcome, note });
    if (outcome === 'overturned') {
      const { authorId, cycle } = this.#flagRecord(flagId);
      this.eligibility.restore(authorId, cycle, { at, reason: `申诉成立（${flagId}），恢复权益；旧判断保留在复核日志` });
    }
    return entry;
  }

  decideSupport(authorId, endISO, { days = 28, at, decidedBy } = {}) {
    const author = this.authors.get(authorId);
    if (!author) throw new Error(`未知作者: ${authorId}`);
    const window = makeWindow(endISO, days);
    const summary = summarizeWindow(this.ledger.byAuthor(authorId), window);
    const decision = decideSupport({
      decisionId: `decision-${++this.decisionSeq}`,
      author,
      summary,
      eligibilityState: this.eligibility.stateOf(authorId, cycleKeyOf(window)),
      at: at ?? window.end,
      decidedBy: decidedBy ?? 'platform-ops',
    });
    this.decisions.set(decision.decision_id, decision);
    return decision;
  }

  explain(decisionId) {
    const decision = this.decisions.get(decisionId);
    if (!decision) throw new Error(`扶持决定不存在: ${decisionId}`);
    return explainDecision(decision);
  }

  // 效果回看：扶持前后两个窗口的持续创作与真实受众留存对比。
  lookback(authorId, { preEnd, postEnd, days = 28 }) {
    const preWindow = makeWindow(preEnd, days);
    const postWindow = makeWindow(postEnd, days);
    const natural = this.ledger.effective(authorId).filter((e) => e.channel_kind === 'natural_share');
    const works = this.works.filter((w) => w.author_id === authorId);
    const report = compareEffect({
      preEvents: natural.filter((e) => inWindow(e.occurred_at, preWindow)),
      postEvents: natural.filter((e) => inWindow(e.occurred_at, postWindow)),
      preWorks: works.filter((w) => inWindow(w.published_at, preWindow)),
      postWorks: works.filter((w) => inWindow(w.published_at, postWindow)),
    });
    return { author_id: authorId, pre_window: preWindow, post_window: postWindow, ...report };
  }

  viewEvents(role, authorId = null) {
    const events = authorId === null ? this.ledger.all() : this.ledger.byAuthor(authorId);
    return events.map((e) => projectEvent(e, role));
  }

  viewSummary(role, authorId, endISO, { days = 28 } = {}) {
    const window = makeWindow(endISO, days);
    return projectSummary(summarizeWindow(this.ledger.byAuthor(authorId), window), role);
  }

  journal(flagId = null) {
    return this.reviewBoard.journal(flagId);
  }
}
