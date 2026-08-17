// ============================================================
// Structured Output 评分器 v2（GPT5.6 结构化输出）
// SO 维度：语法解析 20% + Schema 合规 25% + 字段约束 20%
//         + 跨字段一致性 20% + 可执行/可渲染 10% + 输出纪律 5%
// ============================================================

import type { Scenario, ScenarioResult, OutputMetadata, ModelResponse } from '@zxbench/types';
import type { Evaluator } from './index.js';
import { parseByFormat, type SupportedFormat } from '../parsers/index.js';

export const structuredOutputEvaluator: Evaluator = {
  name: 'schema_compliance',
  version: 'schema_compliance_v2',
  aliases: ['structured_output_v2'],

  async evaluate(
    scenario: Scenario,
    modelOutput: string,
    metadata: OutputMetadata,
    modelResponse: ModelResponse,
  ): Promise<Partial<ScenarioResult>> {
    const axisScores: Record<string, number> = {};
    const evidence: string[] = [];

    // 确定输出格式
    const format = detectFormat(scenario);

    // 1. 语法解析 (20%)
    const parseResult = parseByFormat(format, modelOutput, {
      schema: scenario.schema,
      expectedColumns: scenario.constraints,
    });

    if (parseResult.success) {
      axisScores.syntax_parse = 100;
      evidence.push(`Format "${format}" parsed successfully`);
    } else {
      const errorCount = parseResult.violations.filter((v) => v.severity === 'error').length;
      axisScores.syntax_parse = Math.max(0, 100 - errorCount * 25);
      evidence.push(`Format "${format}" parse errors: ${errorCount}`);
      for (const v of parseResult.violations.filter((v) => v.severity === 'error').slice(0, 3)) {
        evidence.push(`  - ${v.message}`);
      }
    }

    // 2. Schema 合规 (25%)
    if (scenario.schema) {
      const schemaViolations = parseResult.violations.filter(
        (v) => v.type === 'schema_mismatch' || v.type === 'missing_required',
      );
      axisScores.schema_compliance = Math.max(0, 100 - schemaViolations.length * 20);
      if (schemaViolations.length === 0) {
        evidence.push('Schema validation passed');
      } else {
        evidence.push(`Schema violations: ${schemaViolations.length}`);
      }
    } else {
      axisScores.schema_compliance = parseResult.success ? 100 : 50;
      evidence.push('No schema defined, using basic format check');
    }

    // 3. 字段约束 (20%)
    if (scenario.constraints && scenario.constraints.length > 0 && parseResult.parsed) {
      let constraintPass = 0;
      for (const constraint of scenario.constraints) {
        if (evaluateConstraint(constraint, parseResult.parsed)) {
          constraintPass++;
        }
      }
      axisScores.field_constraints = Math.round((constraintPass / scenario.constraints.length) * 100);
      evidence.push(`Field constraints: ${constraintPass}/${scenario.constraints.length} passed`);
    } else {
      axisScores.field_constraints = 100;
    }

    // 4. 跨字段一致性 (20%)
    if (parseResult.parsed && typeof parseResult.parsed === 'object') {
      const consistencyScore = checkCrossFieldConsistency(parseResult.parsed as Record<string, unknown>);
      axisScores.cross_field_consistency = consistencyScore;
      evidence.push(`Cross-field consistency: ${consistencyScore}%`);
    } else {
      axisScores.cross_field_consistency = 50;
    }

    // 5. 可执行/可渲染 (10%)
    if (format === 'sql') {
      axisScores.executable = parseResult.success ? 80 : 20;
    } else if (format === 'html') {
      axisScores.executable = parseResult.success ? 80 : 20;
    } else if (format === 'regex') {
      axisScores.executable = parseResult.success ? 90 : 10;
    } else {
      axisScores.executable = parseResult.success ? 100 : 0;
    }

    // 6. 输出纪律 (5%) — 是否有额外无关内容
    const outputLength = modelOutput.length;
    const codeBlockLength = modelOutput.match(/```[\s\S]*?```/g)?.reduce((sum, m) => sum + m.length, 0) || 0;
    const extraRatio = (outputLength - codeBlockLength) / Math.max(outputLength, 1);
    if (extraRatio < 0.2) {
      axisScores.output_discipline = 100;
    } else if (extraRatio < 0.5) {
      axisScores.output_discipline = 70;
    } else {
      axisScores.output_discipline = 40;
      evidence.push(`Excessive extra content outside code block: ${Math.round(extraRatio * 100)}%`);
    }

    // 总分
    const totalScore = Math.round(
      axisScores.syntax_parse * 0.20 +
      axisScores.schema_compliance * 0.25 +
      axisScores.field_constraints * 0.20 +
      axisScores.cross_field_consistency * 0.20 +
      axisScores.executable * 0.10 +
      axisScores.output_discipline * 0.05
    );

    return {
      axisScores,
      totalScore,
      safetyLevel: 'safe',
      evidence,
    };
  },
};

/** 检测输出格式类型 */
function detectFormat(scenario: Scenario): SupportedFormat {
  // 从 grader 名称或 schema 推断
  const grader = scenario.grader.toLowerCase();
  if (grader.includes('json') || grader.includes('structured')) return 'json';
  if (grader.includes('csv')) return 'csv';
  if (grader.includes('xml')) return 'xml';
  if (grader.includes('sql')) return 'sql';
  if (grader.includes('html')) return 'html';
  if (grader.includes('yaml')) return 'yaml';
  if (grader.includes('regex')) return 'regex';

  // 从 schema 推断
  if (scenario.schema) {
    const schemaFormat = (scenario.schema as Record<string, unknown>).format;
    if (typeof schemaFormat === 'string') return schemaFormat as SupportedFormat;
  }

  return 'json'; // 默认 JSON
}

/** 基础跨字段一致性检查 */
function checkCrossFieldConsistency(data: Record<string, unknown>): number {
  let issues = 0;
  const values = Object.values(data);

  // 检查 null/undefined 一致性
  const nullCount = values.filter((v) => v === null || v === undefined).length;
  if (nullCount > 0 && nullCount < values.length) {
    issues += 1; // 部分字段为空
  }

  // 检查类型一致性（数值字段不应包含字符串）
  const numericFields = Object.entries(data).filter(
    ([, v]) => typeof v === 'number',
  );
  const stringNumericFields = Object.entries(data).filter(
    ([, v]) => typeof v === 'string' && !isNaN(Number(v)) && v.trim() !== '',
  );
  if (numericFields.length > 0 && stringNumericFields.length > 0) {
    issues += 1; // 数值字段不一致
  }

  return Math.max(0, 100 - issues * 20);
}

/** 简单约束评估 */
function evaluateConstraint(constraint: string, data: unknown): boolean {
  // 基础约束类型
  if (constraint.startsWith('required:')) {
    const field = constraint.slice(9).trim();
    return data !== null && typeof data === 'object' && field in (data as Record<string, unknown>);
  }
  if (constraint.startsWith('type:')) {
    // type:field=number
    const match = constraint.match(/type:(\w+)=(\w+)/);
    if (match && data && typeof data === 'object') {
      const [, field, type] = match;
      const value = (data as Record<string, unknown>)[field];
      return typeof value === type;
    }
  }
  // 默认通过
  return true;
}
