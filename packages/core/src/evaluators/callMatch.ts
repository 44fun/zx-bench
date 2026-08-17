// ============================================================
// 结构化调用检测（防"提及即得分"）
// 工具/动作检查要求模型以"调用形态"使用工具，而非仅复述名称。
// 供 tool_call_trace / agent_trace 等评分器使用。
// ============================================================

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 检测工具名是否以"结构化调用形态"出现在输出中。
 * 命中形态：<tool>name</tool> 标签 / name( 函数调用 / "name": 或 name: JSON 字段 / "调用 name" 等。
 * @returns 首次调用的下标；未找到返回 -1（可用于顺序校验）
 */
export function findToolCallIndex(output: string, toolName: string): number {
  const o = output.toLowerCase();
  const t = escapeRe(toolName.toLowerCase());
  if (!t) return -1;

  const patterns: Array<[RegExp, () => number]> = [
    // <tool>name</tool> / <tool_call> 内含 name
    [new RegExp(`<tool[^>]*>\\s*${t}\\s*</tool>`), () => { const m = o.match(new RegExp(`<tool[^>]*>\\s*${t}\\s*</tool>`)); return m ? m.index ?? -1 : -1; }],
    [new RegExp(`<tool_call[^>]*${t}`), () => { const m = o.match(new RegExp(`<tool_call[^>]*${t}`)); return m ? m.index ?? -1 : -1; }],
    // 函数调用形态 name(
    [new RegExp(`\\b${t}\\s*\\(`), () => { const m = o.match(new RegExp(`\\b${t}\\s*\\(`)); return m ? m.index ?? -1 : -1; }],
    // JSON / 键值形态 "name": 或 name:
    [new RegExp(`["']?${t}["']?\\s*[:=]`), () => { const m = o.match(new RegExp(`["']?${t}["']?\\s*[:=]`)); return m ? m.index ?? -1 : -1; }],
    // JSON 值形态（严格 JSON 输出题）："tool_name": "get_weather" / "tool": get_weather
    [new RegExp(`[:=]\\s*["']?${t}["']?`), () => { const m = o.match(new RegExp(`[:=]\\s*["']?${t}["']?`)); return m ? m.index ?? -1 : -1; }],
    // 自然语言调用："调用 name" / "使用 name" / "tool: name"
    [new RegExp(`(?:tool|工具|调用|use(?:ing)?|invoke)\\s*[:：]?\\s*${t}`), () => { const m = o.match(new RegExp(`(?:tool|工具|调用|use(?:ing)?|invoke)\\s*[:：]?\\s*${t}`)); return m ? m.index ?? -1 : -1; }],
  ];

  let best = -1;
  for (const [re, pos] of patterns) {
    if (re.test(o)) {
      const idx = pos();
      if (idx !== -1 && (best === -1 || idx < best)) best = idx;
    }
  }
  return best;
}

export function findToolCall(output: string, toolName: string): boolean {
  return findToolCallIndex(output, toolName) !== -1;
}

/**
 * 检测参数 key/value 是否成对出现（key: value / key=value / "key": "value"）。
 * 要求 key 与 value 在同一表达式或同一行内共现，避免"输出中任意位置出现 value"即得分。
 */
export function findParam(output: string, key: string, value: string): boolean {
  const o = output.toLowerCase();
  const k = escapeRe(key.toLowerCase());
  const v = escapeRe(String(value).toLowerCase());

  if (!v) {
    // 空值：退化为"key 出现即命中"（无可比对的值）
    return new RegExp(`["']?${k}["']?\\s*[:=]`).test(o) || o.includes(k.toLowerCase());
  }

  // 成对形态：key: value / key=value / "key": "value"
  const pair = new RegExp(`["']?${k}["']?\\s*[:=]\\s*["']?${v}["']?`);
  if (pair.test(o)) return true;

  // 兜底：同一行内 key 与 value 共现（仍是弱证据，但比裸 value 严格）
  for (const line of o.split('\n')) {
    const l = line.trim();
    if (l.includes(key.toLowerCase()) && l.includes(String(value).toLowerCase())) return true;
  }
  return false;
}
