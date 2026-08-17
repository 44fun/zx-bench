// ============================================================
// 参数化题目引擎（GPT5.6 反污染 §4.4）
// 人名/公司名/数字/日期动态生成
// 同一 run 内所有模型看到相同实例
// 不同 run 使用不同实例
// ============================================================

import type { Scenario, ParameterizedScenario, ParameterVariable } from '@zxbench/types';

/** 变量类型（有数据池的） */
type PoolVariableType = 'person_name' | 'company_name' | 'city_name' | 'color';

/** 预定义数据池 */
const DATA_POOLS: Record<PoolVariableType, string[]> = {
  person_name: [
    '张三', '李四', '王五', '赵六', '钱七', '孙八', '周九', '吴十',
    'Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry',
    '田中太郎', '佐藤花子', 'John Smith', 'Jane Doe', 'Maria Garcia',
  ],
  company_name: [
    '星辰科技', '云端数据', '蓝海集团', '金桥投资', '绿洲生物',
    'Acme Corp', 'Globex Inc', 'Initech', 'Umbrella Corp', 'Wayne Enterprises',
    '华腾实业', '鼎新电子', '瑞丰金融', '恒通物流',
  ],
  city_name: [
    '北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '南京',
    'New York', 'London', 'Tokyo', 'Paris', 'Berlin', 'Sydney',
    '西安', '重庆', '苏州', '天津', '长沙', '青岛',
  ],
  color: [
    '红色', '蓝色', '绿色', '黄色', '紫色', '橙色', '黑色', '白色',
    'red', 'blue', 'green', 'yellow', 'purple', 'orange',
  ],
};

/** 生成随机数 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 生成随机日期 */
function randomDate(yearRange?: [number, number]): string {
  const [startYear, endYear] = yearRange || [2020, 2026];
  const year = randomInt(startYear, endYear);
  const month = randomInt(1, 12);
  const day = randomInt(1, 28);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 从数据池随机选取 */
function randomFromPool(type: PoolVariableType, exclude: string[] = []): string {
  const pool = DATA_POOLS[type] || [];
  const available = pool.filter((item) => !exclude.includes(item));
  if (available.length === 0) return pool[randomInt(0, pool.length - 1)] || 'unknown';
  return available[randomInt(0, available.length - 1)];
}

/**
 * 生成参数化变量实例
 */
export function generateVariables(
  variables: ParameterVariable[],
  existingValues: Record<string, string> = {},
): Record<string, string> {
  const result: Record<string, string> = { ...existingValues };
  const usedNames: string[] = [];
  const usedCompanies: string[] = [];
  const usedCities: string[] = [];

  for (const variable of variables) {
    if (result[variable.name]) continue; // 已有值

    switch (variable.type) {
      case 'person_name':
        result[variable.name] = randomFromPool('person_name', usedNames);
        usedNames.push(result[variable.name]);
        break;
      case 'company_name':
        result[variable.name] = randomFromPool('company_name', usedCompanies);
        usedCompanies.push(result[variable.name]);
        break;
      case 'city_name':
        result[variable.name] = randomFromPool('city_name', usedCities);
        usedCities.push(result[variable.name]);
        break;
      case 'number': {
        const min = variable.min ?? 1;
        const max = variable.max ?? 1000;
        result[variable.name] = String(randomInt(min, max));
        break;
      }
      case 'date':
        result[variable.name] = randomDate(variable.yearRange as [number, number] | undefined);
        break;
      case 'id':
        result[variable.name] = `ID-${randomInt(10000, 99999)}`;
        break;
      case 'color':
        result[variable.name] = randomFromPool('color');
        break;
      default:
        // 自定义值
        if (variable.values && variable.values.length > 0) {
          result[variable.name] = variable.values[randomInt(0, variable.values.length - 1)];
        } else {
          result[variable.name] = `[${variable.name}]`;
        }
    }
  }

  return result;
}

/**
 * 实例化参数化题目
 * 将 {{variable}} 替换为具体值
 */
export function instantiateScenario(
  scenario: Scenario,
  variables: Record<string, string>,
): Scenario {
  let promptTemplate = scenario.promptTemplate;

  for (const [name, value] of Object.entries(variables)) {
    const pattern = new RegExp(`\\{\\{\\s*${name}\\s*\\}\\}`, 'g');
    promptTemplate = promptTemplate.replace(pattern, value);
  }

  return {
    ...scenario,
    promptTemplate,
    promptVariables: { ...scenario.promptVariables, ...variables },
  };
}

/**
 * 创建参数化题目实例
 * @param scenario 含参数化变量的题目
 * @param existingVars 同一 run 内已生成的变量（确保同 run 一致性）
 */
export function createParameterizedInstance(
  scenario: Scenario,
  existingVars: Record<string, string> = {},
): { scenario: Scenario; variables: Record<string, string> } {
  const paramVars = extractParameterVariables(scenario);
  const variables = generateVariables(paramVars, existingVars);
  const instantiated = instantiateScenario(scenario, variables);

  return { scenario: instantiated, variables };
}

/**
 * 从题目定义中提取参数化变量
 */
function extractParameterVariables(scenario: Scenario): ParameterVariable[] {
  const variables: ParameterVariable[] = [];
  const seen = new Set<string>();

  // 从 promptVariables 定义中获取
  if (scenario.promptVariables) {
    for (const [name, value] of Object.entries(scenario.promptVariables)) {
      if (!seen.has(name)) {
        seen.add(name);
        variables.push({
          name,
          type: inferVariableType(name, String(value)),
        });
      }
    }
  }

  // 从 promptTemplate 中的 {{variable}} 模式提取
  const matches = scenario.promptTemplate.matchAll(/\{\{\s*(\w+)\s*\}\}/g);
  for (const match of matches) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      variables.push({
        name,
        type: inferVariableType(name),
      });
    }
  }

  return variables;
}

/** 根据变量名推断类型 */
function inferVariableType(name: string, _value?: string): ParameterVariable['type'] {
  const lower = name.toLowerCase();
  if (lower.includes('name') && (lower.includes('person') || lower.includes('user') || lower.includes('author'))) return 'person_name';
  if (lower.includes('company') || lower.includes('org') || lower.includes('corp')) return 'company_name';
  if (lower.includes('city') || lower.includes('location')) return 'city_name';
  if (lower.includes('date') || lower.includes('time')) return 'date';
  if (lower.includes('number') || lower.includes('count') || lower.includes('amount') || lower.includes('price')) return 'number';
  if (lower.includes('id') || lower.includes('code')) return 'id';
  if (lower.includes('color')) return 'color';
  return 'string';
}
