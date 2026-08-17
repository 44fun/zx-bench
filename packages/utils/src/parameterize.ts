import type { Scenario, ParameterizedScenario, ParameterVariable } from '@zxbench/types';
import { randomInt } from 'node:crypto';

/** 中文常见人名 */
const CN_NAMES = ['张伟', '李娜', '王芳', '刘洋', '陈静', '杨磊', '赵敏', '黄强', '周涛', '吴婷'];
/** 公司名 */
const CN_COMPANIES = ['星辰科技', '云帆信息', '锐思数据', '博远软件', '恒通网络', '智汇系统', '明道技术'];

/** 生成参数化变量 */
export function generateParameterVariable(type: ParameterVariable['type'], name: string, seed?: string): ParameterVariable {
  const pool = type === 'person_name' ? CN_NAMES
    : type === 'company_name' ? CN_COMPANIES
    : type === 'date' ? [new Date().toISOString().slice(0, 10)]
    : type === 'city_name' ? ['北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '南京']
    : type === 'color' ? ['红色', '蓝色', '绿色', '黄色', '紫色']
    : [];

  let value: string | number;

  if (type === 'number') {
    value = seed ? parseInt(seed, 10) : randomInt(100, 9999);
  } else if (type === 'id') {
    value = `ID-${randomInt(10000, 99999)}`;
  } else {
    const idx = seed ? parseInt(seed, 10) % Math.max(pool.length, 1) : randomInt(Math.max(pool.length, 1));
    value = pool[idx] || pool[0] || 'unknown';
  }

  return { name, type, generator: `builtin_${type}`, value };
}

/** 实例化参数化题目 */
export function instantiateScenario(scenario: Scenario, seed?: string): ParameterizedScenario {
  const variables: Record<string, ParameterVariable> = {};
  let instantiatedPrompt = scenario.promptTemplate;

  // 解析 {{variable:type}} 模式
  const varPattern = /\{\{(\w+):(\w+)\}\}/g;
  let match: RegExpExecArray | null;

  while ((match = varPattern.exec(scenario.promptTemplate)) !== null) {
    const [, varName, varType] = match;
    if (!variables[varName]) {
      const varSeed = seed ? `${seed}_${varName}` : undefined;
      variables[varName] = generateParameterVariable(varType as ParameterVariable['type'], varName, varSeed);
    }
    instantiatedPrompt = instantiatedPrompt.replace(match[0], String(variables[varName].value));
  }

  // 也处理已有的 promptVariables
  if (scenario.promptVariables) {
    for (const [key, val] of Object.entries(scenario.promptVariables)) {
      instantiatedPrompt = instantiatedPrompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val));
    }
  }

  return {
    template: scenario,
    variables,
    instantiatedPrompt,
    instantiationSeed: seed || '',
  };
}
