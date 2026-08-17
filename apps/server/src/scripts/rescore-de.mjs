// 重新评分 data_extraction（修复 JSON 提取容错后）
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { dataExtractionEvaluator, registerEvaluator } from '@zxbench/core';

registerEvaluator(dataExtractionEvaluator);

const DB_PATH = process.env.ZXBENCH_DB_PATH || path.resolve(import.meta.dirname, '../../../data/zxbench.db');
const RUN_ID = process.env.RUN_ID || process.argv[2];
if (!RUN_ID) { console.error('请通过 RUN_ID 环境变量或参数指定 run'); process.exit(1); }

function deserializeScenario(sd) {
  return {
    id: sd.id, dimension: sd.dimension, category: sd.category, difficulty: sd.difficulty,
    language: sd.language, locale: sd.locale, status: sd.status, tier: sd.tier || 'public_dev',
    promptTemplate: sd.promptTemplate, sourceCode: sd.sourceCode ?? undefined,
    functionName: sd.functionName ?? undefined, expectedVerdict: sd.expectedVerdict ?? undefined,
    grader: sd.grader, graderVersion: sd.graderVersion, scoring: JSON.parse(sd.scoring || '{}'),
    hiddenTests: sd.hiddenTests ? JSON.parse(sd.hiddenTests) : undefined,
    requirements: sd.requirements ? JSON.parse(sd.requirements) : undefined,
    tags: sd.tags ? JSON.parse(sd.tags) : undefined,
    scenarioVersion: sd.scenarioVersion, scenarioHash: sd.scenarioHash,
    outputPolicy: sd.outputPolicy ?? undefined,
    answerFirst: sd.answerFirst ?? undefined,
    maxAnswerTokens: sd.maxAnswerTokens ?? undefined,
    maxReasoningTokens: sd.maxReasoningTokens ?? undefined,
  };
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA busy_timeout = 10000');

const rows = db.prepare("SELECT * FROM ScenarioResult WHERE evalRunId=? AND dimension='data_extraction' ORDER BY scenarioId").all(RUN_ID);
console.log('重算 data_extraction ' + rows.length + ' 题\n');

let changed = 0;
for (const r of rows) {
  const sd = db.prepare("SELECT * FROM ScenarioDefinition WHERE id = ?").get(r.scenarioId);
  if (!sd) { console.log('  [跳过] ' + r.scenarioId + ' 无题目'); continue; }
  const scenario = deserializeScenario(sd);
  const outputMetadata = JSON.parse(r.outputMetadata || '{}');
  const det = await dataExtractionEvaluator.evaluate(scenario, r.modelOutput, outputMetadata);
  const total = det.totalScore ?? 0;
  const diff = total !== r.totalScore ? '⚠️' : '·';
  console.log('  [' + diff + '] ' + r.scenarioId.padEnd(12) + ' ' + r.totalScore + ' → ' + total + ' | ' + ((det.evidence||[])[0]||'').slice(0,40));
  if (total !== r.totalScore) changed++;
  db.prepare("UPDATE ScenarioResult SET totalScore=?, deterministicScore=?, axisScores=?, axisEvidence=? WHERE id=?")
    .run(total, total, JSON.stringify(det.axisScores||{}), JSON.stringify(det.axisEvidence||{}), r.id);
}
console.log('\n完成，分数变化 ' + changed + ' 条');
db.close();