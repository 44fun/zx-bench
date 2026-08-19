import { PrismaClient } from '@prisma/client';
import { dataExtractionEvaluator } from '@zxbench/core';

const prisma = new PrismaClient();
const runId = process.argv[2] || process.env.RUN_ID;
if (!runId) { console.error('请通过参数或 RUN_ID 环境变量指定 run'); process.exit(1); }

async function main() {
  const results = await prisma.scenarioResult.findMany({
    where: { evalRunId: runId },
  });
  console.log('Found ' + results.length + ' results to re-score\n');

  let updated = 0, scoreBefore = 0, scoreAfter = 0, passedBefore = 0, passedAfter = 0;

  for (const r of results) {
    const scenarioRow = await prisma.scenarioDefinition.findUnique({
      where: { id: r.scenarioId },
    });
    if (!scenarioRow) {
      console.log('  SKIP ' + r.scenarioId + ': scenario not found');
      continue;
    }

    const scenario = {
      ...scenarioRow,
      tier: 'public_dev',
      difficulty: scenarioRow.difficulty,
      status: scenarioRow.status,
      scoring: JSON.parse(scenarioRow.scoring),
      hiddenTests: scenarioRow.hiddenTests ? JSON.parse(scenarioRow.hiddenTests) : undefined,
      requirements: scenarioRow.requirements ? JSON.parse(scenarioRow.requirements) : undefined,
      tags: scenarioRow.tags ? JSON.parse(scenarioRow.tags) : undefined,
    };

    const metadata = JSON.parse(r.outputMetadata);
    const newResult = await dataExtractionEvaluator.evaluate(scenario, r.modelOutput, metadata);
    const oldScore = r.totalScore;
    const newScore = newResult.totalScore ?? 0;

    scoreBefore += oldScore;
    scoreAfter += newScore;
    if (oldScore >= 60) passedBefore++;
    if (newScore >= 60) passedAfter++;

    await prisma.scenarioResult.update({
      where: { id: r.id },
      data: {
        axisScores: JSON.stringify(newResult.axisScores),
        totalScore: newScore,
        evidence: JSON.stringify(newResult.evidence),
        graderVersion: 'json_atomic_fields@json_atomic_v2',
      },
    });

    const flag = oldScore !== newScore ? 'CHANGED' : '  same';
    console.log('  ' + flag + ' ' + r.scenarioId + ': ' + oldScore + ' -> ' + newScore);
    updated++;
  }

  console.log('\n=== Summary ===');
  console.log('Updated: ' + updated + '/' + results.length);
  console.log('Avg score: ' + (scoreBefore / results.length).toFixed(1) + ' -> ' + (scoreAfter / results.length).toFixed(1));
  console.log('Pass rate: ' + passedBefore + '/' + results.length + ' -> ' + passedAfter + '/' + results.length);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1); });
