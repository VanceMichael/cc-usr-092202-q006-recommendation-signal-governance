// 生成运营报告：扶持为何成立 + 扶持前后持续创作与真实受众留存对比。
// 用法：node scripts/operator-report.js
import { readFile } from 'node:fs/promises';
import { runGovernance, buildOperatorReport } from '../src/index.js';

const here = import.meta.url;
const timeline = JSON.parse(await readFile(new URL('../fixtures/timeline.json', here), 'utf8'));
const context = JSON.parse(await readFile(new URL('../fixtures/context.json', here), 'utf8'));

const result = runGovernance(timeline, context, {
  asOf: timeline.decision_as_of,
  windowDays: timeline.window_days,
});

console.log(buildOperatorReport(result));
