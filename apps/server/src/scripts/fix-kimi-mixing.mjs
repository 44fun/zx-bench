// 修复 kimi-k3 旧判分题的混分 bug：用评分器重算原始确定性分 + 复用已存 kimi-k3 judge 分 + coverage 让渡合并
// 不调 Judge API（秒级）。用法: node src/scripts/fix-kimi-mixing.mjs [RUN_ID 或默认 GLM5.2] [DRY_RUN=1]
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import {
  registerEvaluator, getEvaluator,
  bugFindingEvaluator, codeRepairEvaluator, structuredOutputEvaluator,
  dataExtractionEvaluator, exactAnswerLineEvaluator, instructionChecklistEvaluator,
  canaryAuthorityEvaluator, toolCallTraceEvaluator, agentTraceEvaluator, cliCommandEvaluator,
  hallucinationResistanceEvaluator,
} from '@zxbench/core';

const DB_PATH = (process.env.ZXBENCH_DB_PATH || path.resolve(import.meta.dirname, '../../../data/zxbench.db'));
registerEvaluator(bugFindingEvaluator);
registerEvaluator(codeRepairEvaluator);
registerEvaluator(structuredOutputEvaluator);
registerEvaluator(dataExtractionEvaluator);
registerEvaluator(exactAnswerLineEvaluator);
registerEvaluator(instructionChecklistEvaluator);
registerEvaluator(canaryAuthorityEvaluator);
registerEvaluator(toolCallTraceEvaluator);
registerEvaluator(agentTraceEvaluator);
registerEvaluator(cliCommandEvaluator);
registerEvaluator(hallucinationResistanceEvaluator);

function getJudgeWeights(dimension, grader) {
  if (dimension === 'data_extraction' || grader === 'json_atomic_fields') return { deterministic: 1.0, judge: 0.0 };
  if (dimension === 'safety_authority') return { deterministic: 1.0, judge: 0.0 };
  if (dimension === 'structured_output' || grader === 'schema_compliance') return { deterministic: 0.9, judge: 0.1 };
  if (dimension === 'reasoning_math') return { deterministic: 0.95, judge: 0.05 };
  if (dimension === 'program' || grader === 'code_repair') return { deterministic: 0.8, judge: 0.2 };
  if (dimension === 'bug_finding' || grader === 'bug_finding') return { deterministic: 0.4, judge: 0.6 };
  if (dimension === 'instruction_following' || grader === 'instruction_checklist') return { deterministic: 0.5, judge: 0.5 };
  if (dimension === 'agent_workflow' || grader === 'agent_trace') return { deterministic: 0.7, judge: 0.3 };
  if (dimension === 'tool_cli_workflow' || grader === 'tool_call_trace') return { deterministic: 0.7, judge: 0.3 };
  if (dimension === 'cli_deep_tasks' || grader === 'cli_command') return { deterministic: 0.5, judge: 0.5 };
  if (dimension === 'hallucination_resistance' || grader === 'hallucination_resistance') return { deterministic: 1.0, judge: 0.0 };
  return { deterministic: 0.6, judge: 0.4 };
}

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

const dryRun = process.env.DRY_RUN === '1';
const arg = process.argv[2];
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA busy_timeout = 10000');

let run;
if (arg) {
  run = db.prepare("SELECT id, name FROM EvalRun WHERE id = ?").get(arg);
} else {
  run = db.prepare("SELECT r.id, r.name FROM EvalRun r JOIN ModelConfig m ON r.modelConfigId = m.id WHERE m.name LIKE '%glm-5.2%' AND r.status='completed' ORDER BY r.updatedAt DESC LIMIT 1").get();
}
if (!run) { console.error('run not found'); process.exit(1); }
console.log('run:', run.id, '|', run.name);

const rows = db.prepare("SELECT * FROM ScenarioResult WHERE evalRunId=? AND evidence LIKE '%JUDGE_RESCORED%'").all(run.id);
console.log('待修正 JUDGE_RESCORED 题:', rows.length, '条' + (dryRun ? '（DRY-RUN）' : '') + '\n');

let changed = 0, noJudge = 0;
const dimChanges = {};

for (const r of rows) {
  try {
    const sd = db.prepare("SELECT * FROM ScenarioDefinition WHERE id = ?").get(r.scenarioId);
    if (!sd) { console.log('  [跳过] ' + r.scenarioId + ' 无题目定义'); continue; }
    const scenario = deserializeScenario(sd);
    const outputMetadata = JSON.parse(r.outputMetadata || '{}');

    // 1. 重跑评分器 → 原始确定性分 + coverage
    const evaluator = getEvaluator(sd.grader, sd.graderVersion);
    let det;
    if (evaluator) {
      det = await evaluator.evaluate(scenario, r.modelOutput, outputMetadata);
    } else {
      det = { totalScore: r.deterministicScore ?? r.totalScore, axisScores: JSON.parse(r.axisScores || '{}'), axisCoverage: 1 };
    }
    const score = det.totalScore ?? 0;
    const coverage = det.axisCoverage ?? 1;

    // 2. 复用已存 kimi-k3 judge 分
    const judgeScore = r.judgeScore;
    let weights = getJudgeWeights(r.dimension, sd.grader);
    if (weights.judge <= 0) {
      const total = coverage >= 0.5 ? score : Math.round(score * 0.3);
      if (!dryRun) db.prepare("UPDATE ScenarioResult SET totalScore=?, deterministicScore=? WHERE id=?").run(total, score, r.id);
      if (total !== r.totalScore) { changed++; dimChanges[r.dimension] = (dimChanges[r.dimension]||0)+1; }
      continue;
    }
    if (judgeScore == null) { noJudge++; console.log('  [无judge分] ' + r.scenarioId); continue; }

    // 3. formatBlindspot
    const axisScores = det.axisScores || {};
    const codeExtractionFailed = (axisScores.patch_extraction != null && axisScores.patch_extraction <= 40)
      || (det.evidence || []).some(e => e.includes('CODE_EXTRACTION_HEURISTIC'));
    const hasSubstantialOutput = (r.modelOutput || '').trim().length > 20;
    if ((score < 25 && hasSubstantialOutput) || codeExtractionFailed) {
      weights = { deterministic: 0.3, judge: 0.7 };
    }

    // 4. coverage 让渡合并
    const detW = weights.deterministic * coverage;
    const judgeW = weights.judge + weights.deterministic * (1 - coverage);
    const total = Math.round(score * detW + judgeScore * judgeW);

    const diff = total !== r.totalScore ? '⚠️' : '·';
    console.log('  [' + diff + '] ' + r.scenarioId.padEnd(14) + ' (' + r.dimension.padEnd(22) + ') ' + r.totalScore + ' → ' + total + ' (det=' + score + ', judge=' + judgeScore + ', cov=' + coverage.toFixed(2) + ')');
    if (total !== r.totalScore) { changed++; dimChanges[r.dimension] = (dimChanges[r.dimension]||0)+1; }

    if (!dryRun) {
      db.prepare("UPDATE ScenarioResult SET totalScore=?, deterministicScore=? WHERE id=?").run(total, score, r.id);
    }
  } catch (err) {
    console.log('  [错误] ' + r.scenarioId + ': ' + (err instanceof Error ? err.message : String(err)));
  }
}

console.log('\n=== 完成！分数变化 ' + changed + ' 条，无judge分 ' + noJudge + ' 条 ===');
for (const [d, c] of Object.entries(dimChanges)) console.log('  ' + d.padEnd(26), c);
db.close();