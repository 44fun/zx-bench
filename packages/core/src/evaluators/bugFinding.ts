// ============================================================
// Bug Finding 评分器 v3
// 评分契约重构（去除伪轴）：
//   - verdict_correct    : rule      客观规则判定（提取 verdict 对比期望）
//   - output_completeness: rule      截断/不完整检测
//   - patch_test_pass    : verified  修复题在沙箱中应用 patch 跑隐藏测试（JS/TS）
//   移除：root_cause 关键词匹配 / patch_quality 常量 / discipline 常量 / safety 重复计分
//   语义轴（根因、patch 质量、纪律）不再伪装确定性测量，交由 AI Judge 承担（未测量轴不参与加权）
// ============================================================

import type { Scenario, ScenarioResult, OutputMetadata, AxisEvidence } from '@zxbench/types';
import type { Evaluator } from './index.js';
import { checkSafetyRedLines } from '../safety/index.js';
import { runReplacedCodeTest, summarizeTestResults, calculateTestScore } from '../hidden-tests/index.js';

/** 可沙箱执行的语言 */
const EXECUTABLE_LANGS = ['javascript', 'typescript'];

/** Bug Finding 评分器 v3 */
export const bugFindingEvaluator: Evaluator = {
  name: 'bug_finding',
  version: '3.0.0',

  async evaluate(
    scenario: Scenario,
    modelOutput: string,
    outputMetadata: OutputMetadata,
  ): Promise<Partial<ScenarioResult>> {
    const axisScores: Record<string, number> = {};
    const axisEvidence: Record<string, AxisEvidence> = {};
    const evidence: string[] = [];

    // 1. 安全红线检查（一票否决；与 orchestrator 层一致）
    const safetyResult = checkSafetyRedLines(modelOutput);
    if (safetyResult.level === 'red_line') {
      return {
        axisScores: { verdict_correct: 0, output_completeness: 0 },
        axisEvidence: { verdict_correct: 'rule', output_completeness: 'rule' },
        totalScore: 0,
        safetyLevel: 'red_line',
        evidence: ['Safety red line triggered: ' + safetyResult.violations.map((v) => v.type).join(', ')],
      };
    }

    // 2. verdict 判定（rule）— 唯一客观的语义信号
    const verdict = extractVerdict(modelOutput);
    const expectedVerdict = scenario.expectedVerdict;
    const verdictCorrect = verdict === expectedVerdict ? 100 : 0;
    axisScores.verdict_correct = verdictCorrect;
    axisEvidence.verdict_correct = 'rule';
    evidence.push(`Extracted verdict: ${verdict} | Expected: ${expectedVerdict}`);

    // 3. 输出完整性（rule）
    const outputCompleteness = outputMetadata.incomplete ? 0 : 100;
    axisScores.output_completeness = outputCompleteness;
    axisEvidence.output_completeness = 'rule';
    evidence.push(`Output truncated: ${outputMetadata.truncated}`);

    // 4. patch 沙箱测试（verified）— 仅修复题 + 可执行语言 + 有测试用例
    let patchTestPass: number | null = null;
    const lang = (scenario.language || 'javascript').toLowerCase();
    const executable = EXECUTABLE_LANGS.includes(lang);
    const tests = scenario.hiddenTests && scenario.hiddenTests.length > 0
      ? scenario.hiddenTests
      : (scenario.publicTests || []);

    if (expectedVerdict === 'fix') {
      const patch = extractPatch(modelOutput, scenario.functionName);
      if (patch) {
        if (executable && tests.length > 0) {
          const details = await Promise.all(tests.map((tc) => runReplacedCodeTest(patch, tc)));
          const suite = summarizeTestResults(details);
          patchTestPass = calculateTestScore(suite);
          axisScores.patch_test_pass = patchTestPass;
          axisEvidence.patch_test_pass = 'verified';
          evidence.push(`Patch sandbox tests: ${suite.passedTests}/${suite.totalTests} passed`);
        } else {
          // 不可执行或无测试：patch 质量无法验证，交由 AI Judge（不参与确定性加权）
          axisEvidence.patch_test_pass = 'unmeasured';
          evidence.push(`Patch present but not verifiable (lang=${lang}, tests=${tests.length}) — delegated to AI Judge`);
        }
      } else {
        evidence.push('No patch extracted from output');
        axisEvidence.patch_test_pass = 'unmeasured';
      }
    }

    // 5. 总分：仅按已测量轴加权（未测量轴不计入分母）
    //    有测试时: verdict 40% + patch_test 40% + completeness 20%
    //    无测试时: verdict 60% + completeness 40%
    let totalScore: number;
    if (patchTestPass != null) {
      totalScore = Math.round(verdictCorrect * 0.4 + patchTestPass * 0.4 + outputCompleteness * 0.2);
    } else {
      totalScore = Math.round(verdictCorrect * 0.6 + outputCompleteness * 0.4);
    }

    return {
      axisScores,
      axisEvidence,
      totalScore,
      safetyLevel: 'safe',
      evidence,
    };
  },
};

/** 从模型输出中提取 verdict */
function extractVerdict(output: string): 'fix' | 'no_bug' | 'unclear' {
  // 优先检查结构化标签
  const solutionMatch = output.match(/<solution\s+verdict=["']?(fix|no_bug)["']?\s*>/i);
  if (solutionMatch) {
    return solutionMatch[1].toLowerCase() as 'fix' | 'no_bug';
  }

  // 检查 JSON 格式
  try {
    const jsonMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.verdict === 'fix' || parsed.verdict === 'no_bug') {
        return parsed.verdict;
      }
    }
  } catch { /* ignore */ }

  // 关键词匹配（尾部优先）
  const tail = output.slice(-500);
  if (/(?:最终|结论|判定|verdict|conclusion)[：:\s]*(?:fix|修复)/i.test(tail)) return 'fix';
  if (/(?:最终|结论|判定|verdict|conclusion)[：:\s]*(?:no_bug|无\s*bug|没有\s*bug|正确)/i.test(tail)) return 'no_bug';

  // 全文匹配
  if (/\bfix\b/i.test(output)) return 'fix';
  if (/\bno_?bug\b/i.test(output) || /无\s*bug/i.test(output)) return 'no_bug';

  return 'unclear';
}

/** 提取最后一个包含 functionName 的代码块作为 patch（与 code_repair 策略一致） */
function extractPatch(output: string, functionName?: string): string | null {
  const blocks: string[] = [];
  const re = /```(?:[\w+-]*)\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    const code = m[1].trim();
    if (code) blocks.push(code);
  }
  if (blocks.length === 0) return null;
  if (functionName) {
    const withName = blocks.filter((b) => b.includes(functionName));
    if (withName.length > 0) return withName[withName.length - 1];
  }
  return blocks[blocks.length - 1];
}
