// 编排门面：把事件入库、风险标记、人工复核、资格冻结、扶持决策与效果回看串成一条流水线。
// 全流程以判定时点 asOf 为准，可重放历史任意时点。
import { createLedger, ingestAll, effectiveEvents } from './ingest.js';
import { detectRisk } from './classify.js';
import { authorWindowStats } from './windows.js';
import { createReviewBoard, openCasesFromFlags, confirmCase, overturnCase, appealOverturn } from './review.js';
import { createEligibilityLog, freezeForViolation, unfreezeForAppeal, evaluateEligibility } from './eligibility.js';
import { createSupportLog, grantSupport, recordGrant, explainGrant } from './support.js';
import { reviewEffect, formatEffectReview } from './effects.js';
import { createAccessAudit } from './privacy.js';

const STAGE_PACKAGES = {
  cold_start: '冷启动流量包',
  growth: '成长加速包',
  stable: '稳定深耕包',
};

export function runGovernance(timeline, context, { asOf, windowDays, grantedBy = 'platform-ops' }) {
  const ledger = createLedger();
  ingestAll(ledger, timeline.recommendation_events);
  const events = effectiveEvents(ledger, asOf);

  // 1. 风险模型标记（只标记，不处置）
  const board = createReviewBoard();
  const log = createEligibilityLog();
  const allFlags = timeline.authors.flatMap((author) => detectRisk(events, author.id, asOf, windowDays));
  openCasesFromFlags(board, allFlags, 'risk-model', asOf);

  // 2. 人工复核与申诉动作（按时间顺序回放）
  const actions = [...(timeline.review_actions ?? [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const action of actions) {
    if (Date.parse(action.at) > Date.parse(asOf)) { continue; }
    const authorCases = [...board.cases.values()].filter((c) => c.author_id === action.author_id);
    for (const caseRecord of authorCases) {
      if (action.type === 'confirm' && caseRecord.status === 'pending_review') {
        confirmCase(board, caseRecord.id, action.by, action.at, action.reason);
        freezeForViolation(log, action.author_id, caseRecord.id, action.by, action.at, action.reason);
      } else if (action.type === 'overturn' && caseRecord.status === 'pending_review') {
        overturnCase(board, caseRecord.id, action.by, action.at, action.reason);
      } else if (action.type === 'appeal_overturn' && caseRecord.status === 'confirmed_violation') {
        appealOverturn(board, caseRecord.id, action.by, action.at, action.reason);
        unfreezeForAppeal(log, action.author_id, caseRecord.id, action.by, action.at, action.reason);
      }
    }
  }

  // 3. 统计窗口 + 资格判定 + 扶持发放
  const scenarios = new Map(context.records.filter((r) => r.kind === 'scenario').map((r) => [r.id, r]));
  const supportLog = createSupportLog();
  const statsByAuthor = new Map();
  const decisions = [];
  for (const author of timeline.authors) {
    const stats = authorWindowStats(events, author.id, asOf, windowDays);
    statsByAuthor.set(author.id, stats);
    const decision = evaluateEligibility({ author, stats, board, log, asOf });
    decision.window_days = windowDays;
    decisions.push(decision);
    if (decision.eligible) {
      const grant = grantSupport({
        author,
        scenario: scenarios.get(author.scenario_id),
        decision,
        grantedAt: asOf,
        grantedBy,
        package_name: STAGE_PACKAGES[author.stage],
      });
      recordGrant(supportLog, grant);
    }
  }

  // 4. 效果回看（仅对已发放的扶持）
  const effects = supportLog.grants.map((grant) => reviewEffect({
    grant,
    works: timeline.works,
    events,
    followupVisits: timeline.followup_visits ?? [],
  }));

  return {
    asOf,
    windowDays,
    ledger,
    board,
    eligibilityLog: log,
    supportLog,
    statsByAuthor,
    decisions,
    effects,
    accessAudit: createAccessAudit(),
  };
}

export function buildOperatorReport(result) {
  const lines = [`推荐信号治理运营报告（判定时点 ${result.asOf}，窗口 ${result.windowDays} 天）`, ''];
  lines.push('一、资格判定');
  for (const decision of result.decisions) {
    const stats = result.statsByAuthor.get(decision.author_id);
    lines.push(`- ${decision.author_id}（${decision.stage}）：${decision.eligible ? '通过' : '未通过'}` +
      `｜自然 ${stats.organic_count}／活动 ${stats.campaign_count}／付费 ${stats.paid_count}` +
      `｜重放去重 ${stats.replayed_deduped_count}｜撤销 ${stats.revoked_count}` +
      (decision.reasons.length ? `｜原因：${decision.reasons.join('；')}` : ''));
  }
  lines.push('', '二、扶持成立解释');
  for (const grant of result.supportLog.grants) {
    lines.push(explainGrant(grant, result.statsByAuthor.get(grant.author_id)), '');
  }
  lines.push('三、效果回看');
  for (const review of result.effects) {
    lines.push(formatEffectReview(review), '');
  }
  return lines.join('\n');
}

export { explainGrant, reviewEffect, formatEffectReview };
