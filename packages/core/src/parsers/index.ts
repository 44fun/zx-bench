// ============================================================
// 格式专用解析器（GPT5.6 结构化输出 P1-2）
// JSON / YAML / CSV / XML / SQL / HTML / Mermaid / Regex
// 每种解析器返回统一的 FormatParseResult
// ============================================================

import type { FormatParseResult, FormatViolation } from '@zxbench/types';

// ===== JSON 解析器 =====

export function parseJSON(
  content: string,
  schema?: Record<string, unknown>,
): FormatParseResult {
  const violations: FormatViolation[] = [];

  // 尝试提取 JSON（从 markdown code block 或纯文本）
  let jsonStr = content.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);

    // JSON Schema 基础校验
    if (schema) {
      const schemaViolations = validateJsonSchema(parsed, schema);
      violations.push(...schemaViolations);
    }

    return {
      format: 'json',
      success: violations.length === 0,
      parsed,
      violations,
    };
  } catch (err) {
    violations.push({
      type: 'parse_error',
      message: err instanceof Error ? err.message : 'Invalid JSON',
      severity: 'error',
    });
    return { format: 'json', success: false, violations };
  }
}

/** 基础 JSON Schema 校验（MVP 实现） */
function validateJsonSchema(data: unknown, schema: Record<string, unknown>): FormatViolation[] {
  const violations: FormatViolation[] = [];
  const schemaType = schema.type as string | undefined;

  if (schemaType) {
    const actualType = Array.isArray(data) ? 'array' : typeof data;
    if (actualType !== schemaType) {
      violations.push({
        type: 'schema_mismatch',
        message: `Expected type "${schemaType}" but got "${actualType}"`,
        severity: 'error',
      });
    }
  }

  if (schemaType === 'object' && typeof data === 'object' && data !== null) {
    const required = schema.required as string[] | undefined;
    const properties = schema.properties as Record<string, unknown> | undefined;

    if (required) {
      for (const key of required) {
        if (!(key in data)) {
          violations.push({
            type: 'missing_required',
            message: `Missing required field: "${key}"`,
            severity: 'error',
          });
        }
      }
    }

    if (properties) {
      for (const [key, propSchema] of Object.entries(properties)) {
        if (key in data) {
          const propViolations = validateJsonSchema(
            (data as Record<string, unknown>)[key],
            propSchema as Record<string, unknown>,
          );
          violations.push(...propViolations.map((v) => ({
            ...v,
            message: `[${key}] ${v.message}`,
          })));
        }
      }
    }
  }

  return violations;
}

// ===== CSV 解析器（RFC 4180） =====

export function parseCSV(
  content: string,
  options?: { expectedColumns?: string[]; minRows?: number; maxRows?: number },
): FormatParseResult {
  const violations: FormatViolation[] = [];

  // 提取 CSV 内容（从 code block 或纯文本）
  let csvStr = content.trim();
  const codeBlockMatch = csvStr.match(/```(?:csv)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    csvStr = codeBlockMatch[1].trim();
  }

  try {
    const rows = parseCSVRows(csvStr);

    if (rows.length === 0) {
      violations.push({ type: 'empty_content', message: 'CSV is empty', severity: 'error' });
      return { format: 'csv', success: false, violations };
    }

    const headers = rows[0];

    // 列数一致性检查
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].length !== headers.length) {
        violations.push({
          type: 'column_mismatch',
          message: `Row ${i + 1} has ${rows[i].length} columns, expected ${headers.length}`,
          severity: 'error',
        });
      }
    }

    // 期望列名检查
    if (options?.expectedColumns) {
      for (const col of options.expectedColumns) {
        if (!headers.includes(col)) {
          violations.push({
            type: 'missing_column',
            message: `Expected column "${col}" not found in headers`,
            severity: 'error',
          });
        }
      }
    }

    // 行数检查
    if (options?.minRows && rows.length - 1 < options.minRows) {
      violations.push({
        type: 'insufficient_rows',
        message: `Expected at least ${options.minRows} rows, got ${rows.length - 1}`,
        severity: 'warning',
      });
    }
    if (options?.maxRows && rows.length - 1 > options.maxRows) {
      violations.push({
        type: 'excess_rows',
        message: `Expected at most ${options.maxRows} rows, got ${rows.length - 1}`,
        severity: 'warning',
      });
    }

    return {
      format: 'csv',
      success: violations.filter((v) => v.severity === 'error').length === 0,
      parsed: { headers, rows: rows.slice(1) },
      violations,
    };
  } catch (err) {
    violations.push({
      type: 'parse_error',
      message: err instanceof Error ? err.message : 'Invalid CSV',
      severity: 'error',
    });
    return { format: 'csv', success: false, violations };
  }
}

/** RFC 4180 CSV 解析 */
function parseCSVRows(input: string): string[][] {
  const rows: string[][] = [];
  let current = '';
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        row.push(current.trim());
        current = '';
      } else if (char === '\n' || (char === '\r' && next === '\n')) {
        row.push(current.trim());
        if (row.some((cell) => cell !== '')) rows.push(row);
        row = [];
        current = '';
        if (char === '\r') i++;
      } else {
        current += char;
      }
    }
  }

  // 最后一行
  row.push(current.trim());
  if (row.some((cell) => cell !== '')) rows.push(row);

  return rows;
}

// ===== XML 解析器 =====

export function parseXML(content: string): FormatParseResult {
  const violations: FormatViolation[] = [];

  let xmlStr = content.trim();
  const codeBlockMatch = xmlStr.match(/```(?:xml)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    xmlStr = codeBlockMatch[1].trim();
  }

  // 基础 XML 格式检查
  if (!xmlStr.startsWith('<?xml') && !xmlStr.startsWith('<')) {
    violations.push({
      type: 'parse_error',
      message: 'Content does not appear to be XML',
      severity: 'error',
    });
    return { format: 'xml', success: false, violations };
  }

  // 标签闭合检查
  const openTags = xmlStr.match(/<([a-zA-Z][a-zA-Z0-9]*)[^>]*[^/]?>/g) || [];
  const closeTags = xmlStr.match(/<\/([a-zA-Z][a-zA-Z0-9]*)>/g) || [];
  const selfClosing = xmlStr.match(/<[a-zA-Z][a-zA-Z0-9]*[^>]*\/>/g) || [];

  const openCount: Record<string, number> = {};
  for (const tag of openTags) {
    const name = tag.match(/<([a-zA-Z][a-zA-Z0-9]*)/)?.[1] || '';
    openCount[name] = (openCount[name] || 0) + 1;
  }
  for (const tag of closeTags) {
    const name = tag.match(/<\/([a-zA-Z][a-zA-Z0-9]*)>/)?.[1] || '';
    openCount[name] = (openCount[name] || 0) - 1;
  }

  for (const [name, count] of Object.entries(openCount)) {
    if (count > 0) {
      violations.push({
        type: 'unclosed_tag',
        message: `Tag "${name}" is not properly closed (${count} unclosed)`,
        severity: 'error',
      });
    } else if (count < 0) {
      violations.push({
        type: 'extra_close_tag',
        message: `Tag "${name}" has ${-count} extra closing tags`,
        severity: 'error',
      });
    }
  }

  return {
    format: 'xml',
    success: violations.filter((v) => v.severity === 'error').length === 0,
    parsed: xmlStr,
    violations,
  };
}

// ===== SQL 解析器（基础语法检查） =====

export function parseSQL(content: string): FormatParseResult {
  const violations: FormatViolation[] = [];

  let sqlStr = content.trim();
  const codeBlockMatch = sqlStr.match(/```(?:sql)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    sqlStr = codeBlockMatch[1].trim();
  }

  // 基础 SQL 语法检查
  const statements = sqlStr.split(';').map((s) => s.trim()).filter((s) => s.length > 0);

  if (statements.length === 0) {
    violations.push({ type: 'empty_content', message: 'No SQL statements found', severity: 'error' });
    return { format: 'sql', success: false, violations };
  }

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const firstWord = stmt.split(/\s+/)[0]?.toUpperCase();

    const validKeywords = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'WITH', 'EXPLAIN', 'SHOW', 'DESCRIBE'];
    if (!validKeywords.includes(firstWord)) {
      violations.push({
        type: 'invalid_syntax',
        message: `Statement ${i + 1}: unexpected keyword "${firstWord}"`,
        severity: 'warning',
      });
    }

    // 检查括号平衡
    let parenDepth = 0;
    for (const char of stmt) {
      if (char === '(') parenDepth++;
      if (char === ')') parenDepth--;
      if (parenDepth < 0) {
        violations.push({
          type: 'unmatched_paren',
          message: `Statement ${i + 1}: unmatched closing parenthesis`,
          severity: 'error',
        });
        break;
      }
    }
    if (parenDepth > 0) {
      violations.push({
        type: 'unmatched_paren',
        message: `Statement ${i + 1}: ${parenDepth} unclosed parenthesis`,
        severity: 'error',
      });
    }
  }

  return {
    format: 'sql',
    success: violations.filter((v) => v.severity === 'error').length === 0,
    parsed: statements,
    violations,
  };
}

// ===== HTML 解析器 =====

export function parseHTML(content: string): FormatParseResult {
  const violations: FormatViolation[] = [];

  let htmlStr = content.trim();
  const codeBlockMatch = htmlStr.match(/```(?:html)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    htmlStr = codeBlockMatch[1].trim();
  }

  // 基础 HTML 结构检查
  const hasDoctype = htmlStr.toLowerCase().startsWith('<!doctype');
  const hasHtmlTag = /<html[\s>]/i.test(htmlStr);
  const hasHeadTag = /<head[\s>]/i.test(htmlStr);
  const hasBodyTag = /<body[\s>]/i.test(htmlStr);

  if (!hasDoctype) {
    violations.push({ type: 'missing_structure', message: 'Missing DOCTYPE declaration', severity: 'warning' });
  }
  if (!hasHtmlTag) {
    violations.push({ type: 'missing_structure', message: 'Missing <html> tag', severity: 'warning' });
  }
  if (!hasHeadTag) {
    violations.push({ type: 'missing_structure', message: 'Missing <head> tag', severity: 'warning' });
  }
  if (!hasBodyTag) {
    violations.push({ type: 'missing_structure', message: 'Missing <body> tag', severity: 'warning' });
  }

  // 标签闭合检查（简化版）
  const voidElements = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);
  const openTags = (htmlStr.match(/<([a-zA-Z][a-zA-Z0-9]*)[^>]*(?<!\/)>/g) || [])
    .map((t) => t.match(/<([a-zA-Z][a-zA-Z0-9]*)/)?.[1]?.toLowerCase() || '')
    .filter((t) => !voidElements.has(t));
  const closeTags = (htmlStr.match(/<\/([a-zA-Z][a-zA-Z0-9]*)>/g) || [])
    .map((t) => t.match(/<\/([a-zA-Z][a-zA-Z0-9]*)>/)?.[1]?.toLowerCase() || '');

  const tagBalance: Record<string, number> = {};
  for (const tag of openTags) tagBalance[tag] = (tagBalance[tag] || 0) + 1;
  for (const tag of closeTags) tagBalance[tag] = (tagBalance[tag] || 0) - 1;

  for (const [tag, balance] of Object.entries(tagBalance)) {
    if (balance > 0) {
      violations.push({ type: 'unclosed_tag', message: `Tag <${tag}> not closed (${balance} unclosed)`, severity: 'warning' });
    }
  }

  return {
    format: 'html',
    success: violations.filter((v) => v.severity === 'error').length === 0,
    parsed: htmlStr,
    violations,
  };
}

// ===== YAML 解析器（基础） =====

export function parseYAML(content: string): FormatParseResult {
  const violations: FormatViolation[] = [];

  let yamlStr = content.trim();
  const codeBlockMatch = yamlStr.match(/```(?:yaml|yml)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    yamlStr = codeBlockMatch[1].trim();
  }

  // 基础 YAML 格式检查（不依赖外部库）
  const lines = yamlStr.split('\n');
  let hasKey = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    // 检查缩进一致性
    const indent = line.match(/^(\s*)/)?.[1] || '';
    if (indent.includes('\t')) {
      violations.push({
        type: 'invalid_indent',
        message: `Line ${i + 1}: tabs are not allowed in YAML`,
        severity: 'error',
      });
    }

    // 检查 key: value 格式
    if (/^[a-zA-Z_][\w-]*\s*:/.test(line.trim())) {
      hasKey = true;
    } else if (!line.trim().startsWith('-') && !line.trim().startsWith(':') && !line.includes(':')) {
      violations.push({
        type: 'invalid_syntax',
        message: `Line ${i + 1}: invalid YAML syntax`,
        severity: 'warning',
      });
    }
  }

  if (!hasKey) {
    violations.push({ type: 'invalid_syntax', message: 'No key-value pairs found', severity: 'error' });
  }

  return {
    format: 'yaml',
    success: violations.filter((v) => v.severity === 'error').length === 0,
    parsed: yamlStr,
    violations,
  };
}

// ===== 正则解析器 =====

export function parseRegex(
  content: string,
  options?: { positiveSamples?: string[]; negativeSamples?: string[] },
): FormatParseResult {
  const violations: FormatViolation[] = [];

  let regexStr = content.trim();
  const codeBlockMatch = regexStr.match(/```(?:regex)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    regexStr = codeBlockMatch[1].trim();
  }

  // 尝试解析正则
  let regex: RegExp;
  try {
    // 尝试 /pattern/flags 格式
    const match = regexStr.match(/^\/(.+)\/([gimsuy]*)$/);
    if (match) {
      regex = new RegExp(match[1], match[2]);
    } else {
      regex = new RegExp(regexStr);
    }
  } catch (err) {
    violations.push({
      type: 'parse_error',
      message: err instanceof Error ? err.message : 'Invalid regex',
      severity: 'error',
    });
    return { format: 'regex', success: false, violations };
  }

  // 正反样本测试
  if (options?.positiveSamples) {
    for (const sample of options.positiveSamples) {
      if (!regex.test(sample)) {
        violations.push({
          type: 'test_failure',
          message: `Positive sample "${sample}" did not match`,
          severity: 'error',
        });
      }
    }
  }
  if (options?.negativeSamples) {
    for (const sample of options.negativeSamples) {
      if (regex.test(sample)) {
        violations.push({
          type: 'test_failure',
          message: `Negative sample "${sample}" should not match`,
          severity: 'error',
        });
      }
    }
  }

  return {
    format: 'regex',
    success: violations.filter((v) => v.severity === 'error').length === 0,
    parsed: regex,
    violations,
  };
}

// ===== Mermaid 解析器（GPT5.6 P0-8） =====

export function parseMermaid(content: string): FormatParseResult {
  const violations: FormatViolation[] = [];

  let mdStr = content.trim();
  const codeBlockMatch = mdStr.match(/```(?:mermaid)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    mdStr = codeBlockMatch[1].trim();
  }

  // 检查是否包含有效的 Mermaid 图表类型
  const validTypes = [
    'graph', 'flowchart', 'sequenceDiagram', 'classDiagram',
    'stateDiagram', 'erDiagram', 'gantt', 'pie', 'gitGraph',
    'journey', 'mindmap', 'timeline', 'sankey', 'xychart',
  ];

  const firstLine = mdStr.split('\n')[0]?.trim() || '';
  const hasValidType = validTypes.some((t) => firstLine.startsWith(t) || firstLine.includes(t));

  if (!hasValidType) {
    violations.push({
      type: 'invalid_syntax',
      message: `No valid Mermaid diagram type found. First line: "${firstLine.slice(0, 50)}"`,
      severity: 'error',
    });
  }

  // 基础语法检查：括号平衡
  let bracketDepth = 0;
  for (const char of mdStr) {
    if (char === '[' || char === '{' || char === '(') bracketDepth++;
    if (char === ']' || char === '}' || char === ')') bracketDepth--;
    if (bracketDepth < 0) {
      violations.push({ type: 'unmatched_bracket', message: 'Unmatched closing bracket', severity: 'error' });
      break;
    }
  }
  if (bracketDepth > 0) {
    violations.push({ type: 'unmatched_bracket', message: `${bracketDepth} unclosed brackets`, severity: 'error' });
  }

  return {
    format: 'mermaid',
    success: violations.filter((v) => v.severity === 'error').length === 0,
    parsed: mdStr,
    violations,
  };
}

// ===== Markdown 解析器（GPT5.6 P0-8） =====

export function parseMarkdown(content: string): FormatParseResult {
  const violations: FormatViolation[] = [];

  let mdStr = content.trim();
  // 如果内容在代码块中，提取出来
  const codeBlockMatch = mdStr.match(/```(?:markdown|md)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    mdStr = codeBlockMatch[1].trim();
  }

  // 检查基本 Markdown 结构
  const hasHeading = /^#{1,6}\s/m.test(mdStr);
  const hasList = /^[-*+]\s/m.test(mdStr) || /^\d+\.\s/m.test(mdStr);
  const hasParagraph = mdStr.split('\n\n').length > 1;
  const hasCodeBlock = /```/.test(mdStr);

  if (!hasHeading && !hasList && !hasParagraph) {
    violations.push({
      type: 'missing_structure',
      message: 'Content does not appear to be valid Markdown (no headings, lists, or paragraphs)',
      severity: 'warning',
    });
  }

  // 检查代码块配对
  const fenceCount = (mdStr.match(/^```/gm) || []).length;
  if (fenceCount % 2 !== 0) {
    violations.push({
      type: 'unclosed_code_block',
      message: `Unclosed code block (${fenceCount} fences, expected even number)`,
      severity: 'error',
    });
  }

  return {
    format: 'markdown',
    success: violations.filter((v) => v.severity === 'error').length === 0,
    parsed: mdStr,
    violations,
  };
}

// ===== TOML 解析器（GPT5.6 P0-8） =====

export function parseTOML(content: string): FormatParseResult {
  const violations: FormatViolation[] = [];

  let tomlStr = content.trim();
  const codeBlockMatch = tomlStr.match(/```(?:toml)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    tomlStr = codeBlockMatch[1].trim();
  }

  const lines = tomlStr.split('\n');
  let hasKey = false;
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '' || line.startsWith('#')) continue;

    // Table header [section]
    if (/^\[[\w.-]+\]$/.test(line)) {
      inTable = true;
      continue;
    }

    // Array of tables [[section]]
    if (/^\[\[[\w.-]+\]\]$/.test(line)) {
      inTable = true;
      continue;
    }

    // Key = value
    if (/^[\w.-]+\s*=/.test(line)) {
      hasKey = true;
      // 检查值格式（基础检查）
      const value = line.split('=').slice(1).join('=').trim();
      if (value === '') {
        violations.push({
          type: 'invalid_syntax',
          message: `Line ${i + 1}: empty value`,
          severity: 'warning',
        });
      }
      continue;
    }

    violations.push({
      type: 'invalid_syntax',
      message: `Line ${i + 1}: invalid TOML syntax`,
      severity: 'warning',
    });
  }

  if (!hasKey) {
    violations.push({ type: 'invalid_syntax', message: 'No key-value pairs found', severity: 'error' });
  }

  return {
    format: 'toml',
    success: violations.filter((v) => v.severity === 'error').length === 0,
    parsed: tomlStr,
    violations,
  };
}

// ===== 统一解析入口（GPT5.6 P0-8 扩展） =====

export type SupportedFormat = 'json' | 'csv' | 'xml' | 'sql' | 'html' | 'yaml' | 'regex' | 'mermaid' | 'markdown' | 'toml';

export function parseByFormat(
  format: SupportedFormat,
  content: string,
  options?: Record<string, unknown>,
): FormatParseResult {
  switch (format) {
    case 'json':
      return parseJSON(content, options?.schema as Record<string, unknown>);
    case 'csv':
      return parseCSV(content, options as { expectedColumns?: string[]; minRows?: number; maxRows?: number });
    case 'xml':
      return parseXML(content);
    case 'sql':
      return parseSQL(content);
    case 'html':
      return parseHTML(content);
    case 'yaml':
      return parseYAML(content);
    case 'regex':
      return parseRegex(content, options as { positiveSamples?: string[]; negativeSamples?: string[] });
    case 'mermaid':
      return parseMermaid(content);
    case 'markdown':
      return parseMarkdown(content);
    case 'toml':
      return parseTOML(content);
    default:
      return {
        format,
        success: false,
        violations: [{ type: 'unsupported', message: `Format "${format}" is not supported`, severity: 'error' }],
      };
  }
}
