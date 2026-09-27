// 效果回看：比较扶持前后两个窗口的持续创作与真实受众留存，验证扶持是否成立。
export const RETENTION_EFFECTIVE = 0.3;
export const RETENTION_POOR = 0.1;

export function compareEffect({ preEvents, postEvents, preWorks, postWorks }) {
  const preRecommenders = new Set(preEvents.map((e) => e.user_id));
  const postRecommenders = new Set(postEvents.map((e) => e.user_id));
  const retained = [...preRecommenders].filter((u) => postRecommenders.has(u));
  const retentionRatio = preRecommenders.size ? retained.length / preRecommenders.size : null;
  const worksPre = preWorks.length;
  const worksPost = postWorks.length;
  const sustained = worksPost >= worksPre;

  const notes = [];
  let verdict;
  if (retentionRatio === null) {
    verdict = sustained ? 'neutral' : 'ineffective';
    notes.push('扶持前没有自然推荐受众，真实受众留存无法计算');
  } else if (retentionRatio >= RETENTION_EFFECTIVE && sustained) {
    verdict = 'effective';
  } else if (retentionRatio < RETENTION_POOR && !sustained) {
    verdict = 'ineffective';
  } else {
    verdict = 'neutral';
  }
  if (!sustained) notes.push(`扶持后作品数 ${worksPost} 低于扶持前 ${worksPre}，持续创作未保持`);

  return {
    creation: { works_pre: worksPre, works_post: worksPost, sustained },
    audience: {
      natural_recommenders_pre: preRecommenders.size,
      natural_recommenders_post: postRecommenders.size,
      retained: retained.length,
      retention_ratio: retentionRatio === null ? null : Number(retentionRatio.toFixed(4)),
      new_post: [...postRecommenders].filter((u) => !preRecommenders.has(u)).length,
    },
    verdict,
    notes,
  };
}
