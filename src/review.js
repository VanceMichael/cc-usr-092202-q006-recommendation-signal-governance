// 反作弊审查与申诉：风险模型只标记待复核，由授权审查员人工确认或排除。
// 所有结论只追加；申诉成功恢复权益，但旧判断保留留痕，不删除。
export const CASE_STATUS = {
  PENDING: 'pending_review',
  CONFIRMED: 'confirmed_violation',
  OVERTURNED: 'overturned', // 人工排除或申诉成功
};

export function createReviewBoard() {
  return { cases: new Map(), actions: [] };
}

// 风险标记进入待复核队列，同一作者同类未决标记合并为一个案件。
export function openCasesFromFlags(board, flags, openedBy, openedAt) {
  const opened = [];
  for (const flag of flags) {
    const key = `${flag.author_id}:${flag.rule}`;
    const existing = board.cases.get(key);
    if (existing && existing.status === CASE_STATUS.PENDING) {
      existing.flags.push(flag);
      continue;
    }
    if (existing) { continue; } // 已有终局结论的规则不重复建案
    const caseRecord = {
      id: `case_${key}`,
      key,
      author_id: flag.author_id,
      rule: flag.rule,
      status: CASE_STATUS.PENDING,
      opened_at: openedAt,
      opened_by: openedBy,
      flags: [flag],
      decisions: [],
    };
    board.cases.set(key, caseRecord);
    board.actions.push({ at: openedAt, by: openedBy, type: 'case_opened', case_id: caseRecord.id });
    opened.push(caseRecord);
  }
  return opened;
}

// 审查员确认违规：成立冻结依据。
export function confirmCase(board, caseId, decidedBy, decidedAt, reason) {
  return decide(board, caseId, CASE_STATUS.CONFIRMED, decidedBy, decidedAt, reason, 'review');
}

// 审查员排除误报。
export function overturnCase(board, caseId, decidedBy, decidedAt, reason) {
  return decide(board, caseId, CASE_STATUS.OVERTURNED, decidedBy, decidedAt, reason, 'review');
}

// 申诉成功：恢复权益；旧判断不删除，以“申诉推翻”的新决定追加在后面。
export function appealOverturn(board, caseId, decidedBy, decidedAt, reason) {
  const caseRecord = findCase(board, caseId);
  if (caseRecord.status !== CASE_STATUS.CONFIRMED) {
    throw new Error(`只有已确认违规的案件可申诉：${caseId} 当前状态 ${caseRecord.status}`);
  }
  return decide(board, caseId, CASE_STATUS.OVERTURNED, decidedBy, decidedAt, reason, 'appeal');
}

function decide(board, caseId, status, decidedBy, decidedAt, reason, source) {
  const caseRecord = findCase(board, caseId);
  if (caseRecord.status !== CASE_STATUS.PENDING && status === CASE_STATUS.CONFIRMED) {
    throw new Error(`案件已有终局结论：${caseId}`);
  }
  const decision = { at: decidedAt, by: decidedBy, status, reason, source };
  // 案件对象原地追加决定，但历史决定永不移除——旧判断保留。
  caseRecord.decisions.push(decision);
  caseRecord.status = status;
  board.actions.push({ at: decidedAt, by: decidedBy, type: `case_${status}`, case_id: caseId, source });
  return caseRecord;
}

function findCase(board, caseId) {
  for (const caseRecord of board.cases.values()) {
    if (caseRecord.id === caseId) { return caseRecord; }
  }
  throw new Error(`未找到复核案件：${caseId}`);
}

// 某作者在某时点是否存在“已确认且未被申诉推翻”的违规。
export function activeViolations(board, authorId, asOf) {
  const asOfTs = Date.parse(asOf);
  const result = [];
  for (const caseRecord of board.cases.values()) {
    if (caseRecord.author_id !== authorId) { continue; }
    const confirmed = caseRecord.decisions
      .filter((decision) => Date.parse(decision.at) <= asOfTs && decision.status === CASE_STATUS.CONFIRMED);
    const overturned = caseRecord.decisions
      .filter((decision) => Date.parse(decision.at) <= asOfTs && decision.status === CASE_STATUS.OVERTURNED);
    if (confirmed.length > overturned.length) { result.push(caseRecord); }
  }
  return result;
}

export function pendingCases(board) {
  return [...board.cases.values()].filter((caseRecord) => caseRecord.status === CASE_STATUS.PENDING);
}
