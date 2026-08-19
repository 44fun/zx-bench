// ============================================================
// 覆盖率感知的加权总分（防止"唯一已测轴归一成满分"）
// 返回归一分数 + 覆盖率。打折/让渡决策由 orchestrator 统一执行：
//   - judge 未参与：覆盖率 < minCoverage 时打折（未验证不保高分）
//   - judge 参与：未测量轴权重让渡给 AI Judge 补判
// ============================================================

export interface CoverageScore {
  /** 已测量轴的归一加权分数（0-100） */
  score: number;
  /** 已测量轴权重占比（0-1） */
  coverage: number;
}

/**
 * 按已测量轴加权归一，并计算覆盖率。
 * @param axes 每个轴 [分数(undefined=未测量), 权重]
 */
export function weightedScoreByCoverage(axes: Array<[number | undefined, number]>): CoverageScore {
  let sum = 0;
  let measuredWeight = 0;
  let totalWeight = 0;

  for (const [score, weight] of axes) {
    totalWeight += weight;
    if (score == null) continue;
    sum += score * weight;
    measuredWeight += weight;
  }

  if (totalWeight === 0 || measuredWeight === 0) {
    return { score: 0, coverage: 0 };
  }

  return {
    score: Math.round(sum / measuredWeight),
    coverage: measuredWeight / totalWeight,
  };
}

/** 覆盖率不足时的打折系数（orchestrator 在 judge 未参与时使用） */
export const LOW_COVERAGE_SCORE_FACTOR = 0.3;
