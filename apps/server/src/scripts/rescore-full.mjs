// 完整重算脚本：重跑最新确定性评分器 + 用 deepseek-v4-pro 重跑 judge + coverage/formatBlindspot 合并
// 用于把历史 run 的分数按当前评分标准重新计算。运行: node src/scripts/rescore-full.mjs [DRY_RUN=1] [LIMIT=N] [CONCURRENCY=4]
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { scryptSync, createDecipheriv } from 'node:crypto';
import {
  runTieredJudge, registerEvaluator, getEvaluator,
  bugFindingEvaluator, codeRepairEvaluator, structuredOutputEvaluator,
  dataExtractionEvaluator, exactAnswerLineEvaluator, instructionChecklistEvaluator,
  canaryAuthorityEvaluator, toolCallTraceEvaluator, agentTraceEvaluator, cliCommandEvaluator,
  hallucinationResistanceEvaluator,
} from '@zxbench/core';

const DB_PATH = (process.env.ZXBENCH_DB_PATH || path.resolve(import.meta.dirname, '../../../data/zxbench.db'));
const ENCRYPTION_KEY = process.env.ZXBENCH_ENCRYPTION_KEY || 'zxbench-default-key-change-me!';
const RUN_ID = process.env.RUN_ID;
if (!RUN_ID) { console.error('请通过环境变量 RUN_ID 指定要重算的 run'); process.exit(1); }

// ===== 注册评分器（与 server/index.ts 一致） =====
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

function decryptApiKey(encrypted) {
  if (!encrypted || !encrypted.includes(':')) return encrypted;
  const key = scryptSync(ENCRYPTION_KEY, 'zxbench-salt', 32);
  const [ivHex, data] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const d = createDecipheriv('aes-256-cbc', key, iv);
  let out = d.update(data, 'hex', 'utf8'); out += d.final('utf8'); return out;
}

// ===== det/judge 权重（与 orchestrator getJudgeWeights 完全一致） =====
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

function computeJudgeScore(j) {
  return j.bugDetection * 25 + j.rootCause * 25 + j.patchCorrectness * 30 + j.scopeDiscipline * 10 + j.outputCompleteness * 10;
}

// ===== ScenarioDefinition 行 → Scenario（参考 rescore-scores.ts） =====
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
const limit = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : undefined;
const concurrency = process.env.CONCURRENCY ? parseInt(process.env.CONCURRENCY, 10) : 4;
// 只重算曾受 Judge 失败/重算影响的题（JUDGE_FAILED 或 JUDGE_RESCORED）
const onlyProblematic = process.env.ONLY_PROBLEMATIC === '1';

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA busy_timeout = 10000');

// judge 模型：deepseek-v4-pro
const judgeRow = db.prepare("SELECT * FROM ModelConfig WHERE name='deepseek-v4-pro' AND modelType='judge' LIMIT 1").get();
if (!judgeRow) { console.error('未找到 deepseek-v4-pro judge 模型'); process.exit(1); }
console.log('Judge 模型: ' + judgeRow.name + ' (' + judgeRow.id + ')');
const localModel = {
  id: judgeRow.id, name: judgeRow.name, provider: judgeRow.provider, baseUrl: judgeRow.baseUrl,
  apiKey: judgeRow.apiKey ? decryptApiKey(judgeRow.apiKey) : undefined,
  defaultParams: JSON.parse(judgeRow.defaultParams || '{}'),
};

// 查结果
const where = "evalRunId=?" + (onlyProblematic ? " AND (evidence LIKE '%JUDGE_FAILED%' OR evidence LIKE '%JUDGE_RESCORED%')" : '');
const rows = db.prepare("SELECT * FROM ScenarioResult WHERE " + where + " ORDER BY finishedAt ASC" + (limit ? ' LIMIT ' + limit : '')).all(RUN_ID);
console.log('待重算 ' + rows.length + ' 条' + (dryRun ? '（DRY-RUN）' : '') + '，并发 ' + concurrency + '\n');

let idx = 0, ok = 0, skip = 0, fail = 0, changed = 0;
const dimChanges = {};

async function worker() {
  while (true) {
    const i = idx++;
    if (i >= rows.length) return;
    const r = rows[i];
    try {
      const sd = db.prepare("SELECT * FROM ScenarioDefinition WHERE id = ?").get(r.scenarioId);
      if (!sd) { skip++; continue; }
      const scenario = deserializeScenario(sd);
      const outputMetadata = JSON.parse(r.outputMetadata || '{}');
      const evidence = JSON.parse(r.evidence || '[]');

      // 1. 重跑最新评分器
      const evaluator = getEvaluator(sd.grader, sd.graderVersion);
      let det;
      if (evaluator) {
        det = await evaluator.evaluate(scenario, r.modelOutput, outputMetadata);
      } else {
        // 评分器未注册：保留原确定性分数
        det = { totalScore: r.deterministicScore ?? r.totalScore, axisScores: JSON.parse(r.axisScores || '{}'), axisEvidence: JSON.parse(r.axisEvidence || '{}'), axisCoverage: 1 };
        evidence.push('RESCORE: no evaluator for ' + sd.grader + '@' + sd.graderVersion);
      }
      const score = det.totalScore ?? 0;
      const coverage = det.axisCoverage ?? 1;

      // 2. 判断是否需要重跑 judge
      let weights = getJudgeWeights(r.dimension, sd.grader);
      if (weights.judge <= 0) {
        // judge 权重=0：确定性打分（coverage 打折）
        const total = coverage >= 0.5 ? score : Math.round(score * 0.3);
        if (!dryRun) {
          db.prepare("UPDATE ScenarioResult SET totalScore=?, deterministicScore=?, axisScores=?, axisEvidence=? WHERE id=?")
            .run(total, score, JSON.stringify(det.axisScores || {}), JSON.stringify(det.axisEvidence || {}), r.id);
        }
        if (total !== r.totalScore) { changed++; dimChanges[r.dimension] = (dimChanges[r.dimension]||0)+1; }
        ok++; continue;
      }

      // 3. formatBlindspot 检测
      const axisScores = det.axisScores || {};
      const codeExtractionFailed = (axisScores.patch_extraction != null && axisScores.patch_extraction <= 40)
        || (det.evidence || []).some(e => e.includes('CODE_EXTRACTION_HEURISTIC'));
      const hasSubstantialOutput = (r.modelOutput || '').trim().length > 20;
      const detScoreVeryLow = score < 25;
      if ((detScoreVeryLow && hasSubstantialOutput) || codeExtractionFailed) {
        weights = { deterministic: 0.3, judge: 0.7 };
      }

      // 4. 重跑 judge（deepseek-v4-pro）
      const requirements = sd.requirements ? JSON.parse(sd.requirements) : undefined;
      const judgeInput = {
        questionId: r.scenarioId, task: sd.promptTemplate, dimension: r.dimension,
        sourceCode: sd.sourceCode ?? undefined,
        requirements: Array.isArray(requirements) ? requirements : [],
        expectedAnswer: requirements,
        expectedVerdict: sd.expectedVerdict ?? undefined,
        candidateAnswer: {}, rawModelOutput: r.modelOutput, outputMetadata,
        codeExtractionFailed, judgeHint: sd.judgeHint ?? undefined,
      };
      const { localJudge, frontierJudge, finalJudge, escalated } = await runTieredJudge(judgeInput, { localModel, escalationThreshold: 0.85 });
      const judgeScore = computeJudgeScore(finalJudge);

      // 5. coverage 让渡合并（与 orchestrator 一致）
      const detW = weights.deterministic * coverage;
      const judgeW = weights.judge + weights.deterministic * (1 - coverage);
      const total = Math.round(score * detW + judgeScore * judgeW);
      const newHr = escalated || total < 30;

      const diff = total !== r.totalScore ? '⚠️' : '·';
      console.log('  [' + diff + '] ' + r.scenarioId.padEnd(14) + ' (' + r.dimension.padEnd(22) + ') ' + r.totalScore + ' → ' + total + ' (det=' + score + ', judge=' + judgeScore.toFixed(1) + ', ' + finalJudge.verdict + ')');
      if (total !== r.totalScore) { changed++; dimChanges[r.dimension] = (dimChanges[r.dimension]||0)+1; }

      if (!dryRun) {
        db.prepare("UPDATE ScenarioResult SET totalScore=?, deterministicScore=?, judgeScore=?, axisScores=?, axisEvidence=?, localJudge=?, frontierJudge=?, finalJudge=?, escalated=?, humanReviewRequired=? WHERE id=?")
          .run(total, score, Math.round(judgeScore), JSON.stringify(det.axisScores||{}), JSON.stringify(det.axisEvidence||{}),
            JSON.stringify(localJudge), frontierJudge ? JSON.stringify(frontierJudge) : null, JSON.stringify(finalJudge),
            escalated ? 1 : 0, newHr ? 1 : 0, r.id);
      }
      ok++;
    } catch (err) {
      console.log('  [错误] ' + r.scenarioId + ': ' + (err instanceof Error ? err.message : String(err)));
      fail++;
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, () => worker()));
console.log('\n=== 完成！成功 ' + ok + '，跳过 ' + skip + '，失败 ' + fail + '，分数变化 ' + changed + ' 条 ===');
for (const [d, c] of Object.entries(dimChanges)) console.log('  ' + d.padEnd(26), c);
db.close();