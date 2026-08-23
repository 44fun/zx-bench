import type { FinishReason, OutputMetadata } from '@zxbench/types';

/** 截断检测模式 */
const TRUNCATION_PATTERNS = [
  /(?:wait|let me|let's check|i'll|i will|continuing|继续|让我)\s*$/i,
  /```\s*$/,  // 代码块只有开始没有结束
  /\.\.\.\s*$/,
  /\/\/\s*\.\.\.\s*$/,
];

/** 检测输出是否被截断 */
export function detectTruncation(
  content: string,
  finishReason: FinishReason,
  maxTokens: number,
  outputTokens: number,
): { truncated: boolean; reasons: string[] } {
  const reasons: string[] = [];

  // finish_reason == length → 触达 max_tokens
  if (finishReason === 'length') {
    reasons.push('finish_reason is length (hit max_tokens)');
  }

  // 输出 token 接近 max_tokens（95% 以上）
  if (outputTokens > maxTokens * 0.95) {
    reasons.push(`output tokens (${outputTokens}) near max_tokens (${maxTokens})`);
  }

  // 未闭合代码围栏：代码题最强截断信号——在 ``` 处被硬切几乎不可能是刻意输出，纳入硬判定
  const openFences = (content.match(/```/g) || []).length;
  if (openFences % 2 !== 0) {
    reasons.push('unclosed code fence');
  }

  // 文本模式检测（省略号/等待词结尾存在歧义，仅作诊断信号不计入硬判定）
  for (const pattern of TRUNCATION_PATTERNS) {
    if (pattern.test(content.trimEnd())) {
      reasons.push(`matches truncation pattern: ${pattern.source}`);
      break;
    }
  }

  return {
    // 硬判定：token 层面证据 + 未闭合代码围栏；歧义性文本启发式不参与
    truncated: finishReason === 'length' || outputTokens > maxTokens * 0.95 || openFences % 2 !== 0,
    reasons,
  };
}

/** 构建完整输出元数据（GPT5.6 P0-1） */
export function buildOutputMetadata(
  content: string,
  finishReason: FinishReason,
  maxTokens: number,
  outputTokens: number,
): OutputMetadata {
  const { truncated, reasons } = detectTruncation(content, finishReason, maxTokens, outputTokens);
  const containsCodeBlock = /```[\s\S]*?```/.test(content);
  const containsFinalConclusion = /(?:最终|结论|判定|verdict|conclusion|final)/i.test(content);

  return {
    finishReason,
    truncated,
    containsCodeBlock,
    containsFinalConclusion,
    outputLength: content.length,
    outputTokens,
    inputTokens: 0, // 由调用方覆盖（orchestrator 从模型响应回填）
    maxTokens,
    // 语义修正：incomplete 仅表示真截断。
    // 「回答中没有出现『结论/最终』等关键词」不代表不完整——数据抽取/代码题的正确答案通常不含这些词，
    // 旧的 `truncated || !containsFinalConclusion` 会把大量正常完成的答案误标为截断，污染归因。
    incomplete: truncated,
    incompleteReasons: truncated ? reasons : undefined,
  };
}
