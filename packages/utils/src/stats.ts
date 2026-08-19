import type { MultiRunStats } from '@zxbench/types';

/** 均值 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 中位数 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 标准差 */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const squaredDiffs = values.map((v) => (v - avg) ** 2);
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1));
}

/** 95% 置信区间（正态近似） */
export function confidenceInterval95(values: number[]): [number, number] {
  if (values.length < 2) return [mean(values), mean(values)];
  const avg = mean(values);
  const sd = stdDev(values);
  const n = values.length;
  const margin = 1.96 * (sd / Math.sqrt(n));
  return [avg - margin, avg + margin];
}

/** Bootstrap 95% 置信区间 */
export function bootstrapCI(
  values: number[],
  iterations = 1000,
  statistic: (arr: number[]) => number = mean,
): [number, number] {
  if (values.length < 2) return [statistic(values), statistic(values)];
  const bootstrapStats: number[] = [];
  const n = values.length;

  for (let i = 0; i < iterations; i++) {
    const sample: number[] = [];
    for (let j = 0; j < n; j++) {
      sample.push(values[Math.floor(Math.random() * n)]);
    }
    bootstrapStats.push(statistic(sample));
  }

  bootstrapStats.sort((a, b) => a - b);
  const lo = bootstrapStats[Math.floor(iterations * 0.025)];
  const hi = bootstrapStats[Math.floor(iterations * 0.975)];
  return [lo, hi];
}

/** 多轮统计（GPT5.6 P1-5 / P3-4） */
export function multiRunStats(
  scores: number[],
  verdicts: string[] = [],
): MultiRunStats {
  const runs = scores.length;
  const truncatedCount = verdicts.filter((v) => v === 'truncated').length;

  return {
    scores,
    mean: mean(scores),
    median: median(scores),
    stdDev: stdDev(scores),
    ci95: confidenceInterval95(scores),
    min: scores.length > 0 ? Math.min(...scores) : 0,
    max: scores.length > 0 ? Math.max(...scores) : 0,
    verdictStability: runs > 0
      ? verdicts.filter((v, _i, arr) => v === arr[0]).length / runs
      : 0,
    truncationRate: runs > 0 ? truncatedCount / runs : 0,
    runsPerQuestion: runs,
  };
}
