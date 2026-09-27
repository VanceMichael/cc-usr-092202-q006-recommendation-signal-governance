// 时间窗口工具：所有统计都以“判定时点”为准，支持历史回看。
export const DAY_MS = 24 * 60 * 60 * 1000;

export function toTs(value) {
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) { throw new Error(`无效时间: ${value}`); }
  return ts;
}

export function windowStart(asOf, windowDays) {
  return toTs(asOf) - windowDays * DAY_MS;
}

export function withinWindow(ts, asOf, windowDays) {
  const t = toTs(ts);
  return t > windowStart(asOf, windowDays) && t <= toTs(asOf);
}

export function between(ts, start, end) {
  const t = toTs(ts);
  return t >= toTs(start) && t <= toTs(end);
}
