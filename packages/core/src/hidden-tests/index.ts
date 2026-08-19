// ============================================================
// 隐藏行为测试框架（GPT5.6 P1-2/P1-3）
// 测试类型：正常样例、边界样例、异常样例、回归样例
// ============================================================

import type { HiddenTestCase, TestDetail, Scenario } from '@zxbench/types';
import { runTestSuite } from '../sandbox/index.js';
export { runTestSuite, runReplacedCodeTest, runReplacedCodeTestPython, getPythonBin } from '../sandbox/index.js';

/** 测试结果汇总 */
export interface TestSuiteResult {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  passRate: number;
  details: TestDetail[];
  byType: Record<string, { total: number; passed: number; passRate: number }>;
}

/**
 * 运行隐藏测试套件
 * @param sourceCode 原始源码
 * @param patch 模型生成的 patch
 * @param scenario 题目定义（含 hiddenTests）
 */
export async function runHiddenTests(
  sourceCode: string,
  patch: string | null,
  scenario: Scenario,
): Promise<TestSuiteResult | null> {
  const hiddenTests = scenario.hiddenTests;
  if (!hiddenTests || hiddenTests.length === 0) {
    return null;
  }

  const details = await runTestSuite(sourceCode, patch, hiddenTests);

  return summarizeTestResults(details);
}

/**
 * 运行公开测试
 */
export async function runPublicTests(
  sourceCode: string,
  patch: string | null,
  scenario: Scenario,
): Promise<TestSuiteResult | null> {
  const publicTests = scenario.publicTests;
  if (!publicTests || publicTests.length === 0) {
    return null;
  }

  const details = await runTestSuite(sourceCode, patch, publicTests);
  return summarizeTestResults(details);
}

/**
 * 汇总测试结果
 */
export function summarizeTestResults(details: TestDetail[]): TestSuiteResult {
  const totalTests = details.length;
  const passedTests = details.filter((d) => d.passed).length;
  const failedTests = details.filter((d) => !d.passed && !d.timedOut).length;
  const skippedTests = details.filter((d) => d.timedOut).length;

  // 按类型分组统计
  const byType: Record<string, { total: number; passed: number; passRate: number }> = {};
  for (const detail of details) {
    const type = detail.testType || 'unknown';
    if (!byType[type]) {
      byType[type] = { total: 0, passed: 0, passRate: 0 };
    }
    byType[type].total++;
    if (detail.passed) byType[type].passed++;
  }
  for (const type of Object.keys(byType)) {
    byType[type].passRate = byType[type].total > 0
      ? Math.round((byType[type].passed / byType[type].total) * 100)
      : 0;
  }

  return {
    totalTests,
    passedTests,
    failedTests,
    skippedTests,
    passRate: totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0,
    details,
    byType,
  };
}

/**
 * 根据测试结果计算测试维度得分
 * 决策优先级：编译结果 > 隐藏测试 > 结构化 verdict > AI Judge > 参考答案文本
 */
export function calculateTestScore(suiteResult: TestSuiteResult): number {
  if (suiteResult.totalTests === 0) return 0;

  // 加权评分：所有测试类型等权重（GPT5.6 P1-5 重新平衡）
  // 边界和异常测试不应低于普通路径
  const weights: Record<string, number> = {
    normal: 1.0,
    boundary: 1.0,
    edge_case: 1.0,
    exception: 1.0,
    regression: 1.25,
    security: 1.5,
    unknown: 1.0,
  };

  let weightedSum = 0;
  let weightTotal = 0;

  for (const detail of suiteResult.details) {
    const weight = weights[detail.testType ?? 'unknown'] ?? 1.0;
    weightedSum += (detail.passed ? 1 : 0) * weight;
    weightTotal += weight;
  }

  return weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 100) : 0;
}

/**
 * 生成隐藏测试模板
 * 用于题目创建时快速生成测试用例
 */
export function generateTestTemplate(
  type: HiddenTestCase['type'],
  description: string,
  testCode: string,
  expectedOutput?: string,
  expectedExitCode?: number,
): HiddenTestCase {
  return {
    id: `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    description,
    testCode,
    expectedOutput,
    expectedExitCode,
    timeout: 5000,
  };
}
