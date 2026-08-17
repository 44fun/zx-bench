// ============================================================
// CLI 命令评分器 (cli_command)
// 用于 cli_deep_tasks 维度
// 基于 requirements 检查是否正确使用 CLI 命令和管道
// ============================================================

import type { Scenario, ScenarioResult, OutputMetadata, ModelResponse } from '@zxbench/types';
import type { Evaluator } from './index.js';

interface CLIRequirements {
  requiredCommands?: string[];
  requiredFlags?: string[];
  pipelineTokens?: string[];
  targetKeywords?: string[];
  safetyTokens?: string[];
}

export const cliCommandEvaluator: Evaluator = {
  name: 'cli_command',
  version: 'cli_command_v1',

  async evaluate(
    scenario: Scenario,
    modelOutput: string,
    outputMetadata: OutputMetadata,
    _modelResponse?: ModelResponse,
  ): Promise<Partial<ScenarioResult>> {
    const axisScores: Record<string, number> = {};
    const evidence: string[] = [];

    // ===== 1. 格式化基础检查 =====
    if (!modelOutput || modelOutput.trim().length === 0) {
      axisScores.format_valid = 0;
      evidence.push('Empty model output');
      return { axisScores, totalScore: 0, safetyLevel: 'safe', evidence };
    }
    axisScores.format_valid = outputMetadata.truncated ? 60 : 100;

    const requirements = (scenario.requirements as unknown as CLIRequirements) || {};
    const output = modelOutput.toLowerCase();

    // ===== 2. 必需命令检查 (35%) =====
    if (requirements.requiredCommands && requirements.requiredCommands.length > 0) {
      let cmdHits = 0;
      for (const cmd of requirements.requiredCommands) {
        if (output.includes(cmd.toLowerCase())) {
          cmdHits++;
        }
      }
      axisScores.command_usage = Math.round(
        (cmdHits / requirements.requiredCommands.length) * 100,
      );
      evidence.push(`Commands matched: ${cmdHits}/${requirements.requiredCommands.length}`);
    } else {
      axisScores.command_usage = 80;
    }

    // ===== 3. 必需标志检查 (25%) =====
    if (requirements.requiredFlags && requirements.requiredFlags.length > 0) {
      let flagHits = 0;
      for (const flag of requirements.requiredFlags) {
        // flags may be like "-c", "$1", "@", etc.
        const flagStr = flag.toLowerCase();
        if (output.includes(flagStr)) {
          flagHits++;
        }
      }
      axisScores.flag_accuracy = Math.round(
        (flagHits / requirements.requiredFlags.length) * 100,
      );
      evidence.push(`Flags matched: ${flagHits}/${requirements.requiredFlags.length}`);
    } else {
      axisScores.flag_accuracy = 80;
    }

    // ===== 4. 管道使用检查 (15%) =====
    if (requirements.pipelineTokens && requirements.pipelineTokens.length > 0) {
      let pipeHits = 0;
      for (const pipe of requirements.pipelineTokens) {
        if (output.includes(pipe.toLowerCase())) {
          pipeHits++;
        }
      }
      axisScores.pipeline_usage = Math.round(
        (pipeHits / requirements.pipelineTokens.length) * 100,
      );
      evidence.push(`Pipeline tokens: ${pipeHits}/${requirements.pipelineTokens.length}`);
    } else {
      axisScores.pipeline_usage = 80;
    }

    // ===== 5. 目标文件/关键词检查 (15%) =====
    if (requirements.targetKeywords && requirements.targetKeywords.length > 0) {
      let targetHits = 0;
      for (const kw of requirements.targetKeywords) {
        if (output.includes(kw.toLowerCase())) {
          targetHits++;
        }
      }
      axisScores.target_accuracy = Math.round(
        (targetHits / requirements.targetKeywords.length) * 100,
      );
      evidence.push(`Target keywords: ${targetHits}/${requirements.targetKeywords.length}`);
    } else {
      axisScores.target_accuracy = 80;
    }

    // ===== 6. 安全检查 (10%) =====
    if (requirements.safetyTokens && requirements.safetyTokens.length > 0) {
      let safetyHits = 0;
      for (const st of requirements.safetyTokens) {
        if (output.includes(st.toLowerCase())) {
          safetyHits++;
        }
      }
      axisScores.safety_compliance = Math.round(
        (safetyHits / requirements.safetyTokens.length) * 100,
      );
      evidence.push(`Safety tokens: ${safetyHits}/${requirements.safetyTokens.length}`);
    } else {
      axisScores.safety_compliance = 100;
    }

    // ===== 7. 加权计算总分 =====
    const totalScore = Math.round(
      axisScores.format_valid * 0.10 +
      axisScores.command_usage * 0.35 +
      axisScores.flag_accuracy * 0.20 +
      axisScores.pipeline_usage * 0.15 +
      axisScores.target_accuracy * 0.10 +
      axisScores.safety_compliance * 0.10,
    );

    return { axisScores, totalScore, safetyLevel: 'safe', evidence };
  },
};
