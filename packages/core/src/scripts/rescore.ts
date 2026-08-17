// ============================================================
// 重评分脚本 — 对已有测试结果使用新评分器重新打分
// 用法: node dist/scripts/rescore.js <runId>
// ============================================================

import { PrismaClient } from '@prisma/client';
import { dataExtractionEvaluator } from '../evaluators/dataExtraction.js';
import { buildOutputMetadata } from '@zxbench/utils';
import type { Scenario, OutputMetadata, OutputPolicy, ScenarioTier } from '@zxbench/types';

const prisma = new PrismaClient();
const runId = process.argv[2];

if (!runId) {
  console.error('Usage: node dist/scripts/rescore.js <runId>');
  process.exit(1);
}

async function main() {
  // 获取所有结果
  const results = await prisma.scenarioResult.findMany({
    where: { evalRunId: runId },
  });

  console.log(`Found ${results.length} results to re-score`);

  let updated = 0;
  let scoreBefore = 0;
  let scoreAfter = 0;
  let passedBefore = 0;
  let passedAfter = 0;

  for (const r of results) {
    // 获取对应的 scenario
    const scenarioRow = await prisma.scenarioDefinition.findUnique({
      where: { id: r.scenarioId },
    });

    if (!scenarioRow) {
      console.log(`  SKIP ${r.scenarioId}: scenario not found`);
      continue;
    }

    // 构建 Scenario 对象
    const scenario: Scenario = {
      ...scenarioRow,
      tier: (scenarioRow as Record<string, unknown>).tier as ScenarioTier || 'public_dev',
      difficulty: scenarioRow.difficulty as 'easy' | 'medium' | 'hard',
      status: scenarioRow.status as 'valid' | 'invalid' | 'ambiguous' | 'needs_context' | 'retired',
      expectedVerdict: (scenarioRow.expectedVerdict ?? undefined) as 'fix' | 'no_bug' | undefined,
      sourceCode: scenarioRow.sourceCode ?? undefined,
      functionName: scenarioRow.functionName ?? undefined,
      outputPolicy: ((scenarioRow as Record<string, unknown>).outputPolicy ?? undefined) as OutputPolicy | undefined,
      scoring: JSON.parse(scenarioRow.scoring),
      hiddenTests: scenarioRow.hiddenTests ? JSON.parse(scenarioRow.hiddenTests) : undefined,
      requirements: scenarioRow.requirements ? JSON.parse(scenarioRow.requirements) : undefined,
      tags: scenarioRow.tags ? JSON.parse(scenarioRow.tags) : undefined,
    };

    // 构建 metadata
    const metadata: OutputMetadata = JSON.parse(r.outputMetadata);

    // 使用新评分器重新评分
    const newResult = await dataExtractionEvaluator.evaluate(
      scenario,
      r.modelOutput,
      metadata,
    );

    const oldScore = r.totalScore;
    const newScore = newResult.totalScore ?? 0;

    scoreBefore += oldScore;
    scoreAfter += newScore;
    if (oldScore >= 60) passedBefore++;
    if (newScore >= 60) passedAfter++;

    // 更新数据库
    await prisma.scenarioResult.update({
      where: { id: r.id },
      data: {
        axisScores: JSON.stringify(newResult.axisScores),
        totalScore: newScore,
        evidence: JSON.stringify(newResult.evidence),
        graderVersion: 'json_atomic_fields@json_atomic_v2',
      },
    });

    const flag = oldScore !== newScore ? 'CHANGED' : 'same';
    console.log(`  ${flag} ${r.scenarioId}: ${oldScore} -> ${newScore}`);
    updated++;
  }

  console.log('\n=== Summary ===');
  console.log(`Updated: ${updated}/${results.length}`);
  console.log(`Avg score: ${(scoreBefore / results.length).toFixed(1)} -> ${(scoreAfter / results.length).toFixed(1)}`);
  console.log(`Pass rate: ${passedBefore}/${results.length} -> ${passedAfter}/${results.length}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
