/**
 * 题集配置审计与补全脚本
 * 扫描三个"容易拿高分"维度的题集配置缺口：
 *   - tool_cli_workflow    : requirements.tool / params 缺失（评分器只能标 unmeasured）
 *   - instruction_following: requirements.constraints 缺失（同样只能标 unmeasured）
 *   - agent_workflow       : expectedActions 缺少 paramPatterns 断言
 * 默认生成"补全草稿"JSON（供人工审阅）；--apply 时把草稿写回数据库。
 *
 * 用法:
 *   npx tsx src/scripts/audit-config-gaps.ts                 # 生成草稿 apps/server/config-gaps.json
 *   npx tsx src/scripts/audit-config-gaps.ts --apply          # 审阅后写库（会读取已编辑的 JSON）
 * 可选: GAPS_DIM=tool_cli_workflow 只审计指定维度
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ===== 手动加载 apps/server/.env（DATABASE_URL） =====
function loadEnv() {
  const envPath = join(process.cwd(), '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv();

const prisma = new PrismaClient();
const OUTPUT_FILE = join(process.cwd(), 'config-gaps.json');
const applyMode = process.argv.includes('--apply');
const autoApplySingle = process.argv.includes('--auto-apply-single');
const autoApplyIF = process.argv.includes('--auto-apply-if');
const autoApplyAgent = process.argv.includes('--auto-apply-agent');
const dimFilter = process.env.GAPS_DIM;

// ===== 从 prompt 提取建议工具（含参数名；识别"可用工具"列表形态） =====
function extractToolCandidates(prompt: string): Array<{ name: string; params: string[] }> {
  const found: Array<{ name: string; params: string[] }> = [];
  const re = /(?:^|\s)([a-z_][a-z0-9_.]*)\(([^)]*)\)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) {
    const name = m[1];
    const params = [...(m[2] || '').matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*[:：]/g)].map((x) => x[1]);
    if (!found.some((f) => f.name === name)) found.push({ name, params });
  }
  // 限定在"工具/工具列表"上下文内出现的（避免匹配到无关函数）
  return found.slice(0, 6);
}

// ===== 从 prompt 提取建议约束句（指令遵循） =====
function extractConstraintDrafts(prompt: string): string[] {
  const drafts: string[] = [];
  const re = /(?:不得|禁止|不要|不能|必须|至少|至多|不超过|不超|少于|多于|恰好|只能|仅可|需|要求|包含|不包含|以.{0,8}结尾|以.{0,8}开头)[^。\n]{0,40}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null && drafts.length < 4) {
    const s = m[0].trim();
    if (s.length >= 4 && !drafts.includes(s)) drafts.push(s);
  }
  return drafts;
}

// ===== 工具/参数调用形态（用于 agent 参数断言草稿） =====
function extractParamCandidates(prompt: string, toolName: string): string[] {
  const found: string[] = [];
  // 在包含工具名的行里找 key=value / "key": 形态
  const lines = prompt.split('\n');
  for (const line of lines) {
    if (!line.toLowerCase().includes(toolName.toLowerCase())) continue;
    const kvs = line.matchAll(/["']?([a-zA-Z_][a-zA-Z0-9_]*)["']?\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([0-9a-zA-Z_.\-]+))/g);
    for (const kv of kvs) {
      const key = kv[1];
      const val = kv[2] ?? kv[3] ?? kv[4];
      if (key && val && !found.includes(key)) found.push(key);
    }
  }
  return found.slice(0, 3);
}

interface GapItem {
  id: string;
  dimension: string;
  reason: string;
  promptPreview: string;
  suggestion: Record<string, unknown>;
  apply?: boolean;
}

// ===== IF 约束自动转换：约束句 → 可执行检查（高置信才生成，低置信返回 null 避免错误约束） =====
interface AutoConstraint { id: string; type: string; description: string; check: Record<string, unknown>; }

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitPatterns(s: string): string[] {
  return s
    .split(/[、，,]/)
    .map((p) => p.replace(/["'""]/g, '').trim())
    .filter((p) => p.length >= 2 && p.length <= 30
      && !/[XxNn…（()）]/.test(p)          // 排除占位符/括号（模板句）
      && !/至少|恰好|不超过|必须|包含|以上|以下|之间|其中/.test(p)); // 排除残留连接词
}

function autoConstraint(desc: string, idx: number): AutoConstraint | null {
  const d = desc.trim();
  const id = `c${idx + 1}`;

  // 1. 英文排除
  if (/(?:不得|不要|不能|禁止|避免).{0,6}(?:英文|英语)/.test(d) || /^不要使用英文/.test(d)) {
    return { id, type: 'english_free', description: d, check: {} };
  }

  // 2. 句子数（"恰好N句话" / "只能有一句话"）
  const sc = d.match(/恰好\s*(\d+)\s*句话?|只能有一句话/);
  if (sc) {
    const count = sc[1] ? Number(sc[1]) : 1;
    return { id, type: 'sentence_count', description: d, check: { count } };
  }

  // 3. 段落数
  const pc = d.match(/恰好\s*(\d+)\s*个?段落/);
  if (pc) return { id, type: 'paragraph_count', description: d, check: { count: Number(pc[1]) } };

  // 4. 长度（字数）—— "个字"必须有"字"字，避免误匹配"恰好N个列表项"等计数约束
  const lenExact = d.match(/恰好\s*(\d+)\s*个字(?:（不含标点）)?/);
  const lenRange = d.match(/字数?在?\s*(\d+)\s*[–\-至到~]\s*(\d+)\s*个?字?/);
  const lenMax = d.match(/字数?[^0-9]{0,8}(?:不超过|少于|小于|最多|至多|最多不能超过)\s*(\d+)\s*个?字?/);
  const lenMin = d.match(/字数?[^0-9]{0,8}(?:不少于|大于|至少|最少)\s*(\d+)\s*个?字?/);
  if (lenExact || lenRange || lenMax || lenMin) {
    const check: Record<string, number> = {};
    if (lenExact) { check.min = Number(lenExact[1]); check.max = Number(lenExact[1]); }
    if (lenRange) { check.min = Number(lenRange[1]); check.max = Number(lenRange[2]); }
    if (lenMax) check.max = Number(lenMax[1]);
    if (lenMin) check.min = Number(lenMin[1]);
    return { id, type: 'length', description: d, check };
  }

  // 5. 排除（不得/不能/不要包含 X）
  const excl = d.match(/(?:不包含|不能包含|不包括|不得包含|不要输出|不要带|不要使用|不要包含|不能包含)\s*([^，。;；\n]{1,40})/);
  if (excl) {
    const patterns = splitPatterns(excl[1]);
    if (patterns.length > 0) return { id, type: 'exclusion', description: d, check: { patterns } };
  }

  // 6. 包含（必须包含 X / 包含 X）
  const incl = d.match(/(?:必须包含|必须提到|必须提及|必须重复|包含)\s*([^，。;；\n]{1,80})/);
  if (incl) {
    const patterns = splitPatterns(incl[1]);
    const requireAll = /(?:以下所有|全部|所有|都)/.test(d) || patterns.length > 1;
    if (patterns.length > 0) return { id, type: 'inclusion', description: d, check: { patterns, requireAll } };
  }

  // 无法可靠表达 → 不生成（宁可少测，不产生错误约束）
  return null;
}

// ===== agent 参数断言：从"可用动作"列表（tool(param1, param2)）提取参数名 =====
function extractAgentParams(prompt: string, toolName: string): string[] {
  const m = prompt.match(new RegExp(`${escapeRe(toolName)}\\(([^)]*)\\)`));
  if (!m) return [];
  const skip = new Set(['string', 'number', 'boolean', 'object', 'array', 'int', 'str', 'any', 'null', 'void']);
  return m[1]
    .split(/[,，]/)
    .map((s) => s.trim().split(/[:：\s]/)[0])
    .filter((p) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(p) && !skip.has(p))
    .slice(0, 4);
}

async function main() {
  // ===== 自动补全模式：对 tool_cli 中"唯一候选工具"的题直接写库（无需人工编辑 JSON） =====
  if (autoApplySingle) {
    if (!existsSync(OUTPUT_FILE)) {
      console.error(`未找到 ${OUTPUT_FILE}，请先运行审计生成草稿`);
      process.exit(1);
    }
    const data = JSON.parse(readFileSync(OUTPUT_FILE, 'utf8')) as { items: GapItem[] };
    const singles = data.items.filter((i) =>
      i.dimension === 'tool_cli_workflow'
      && Array.isArray(i.suggestion.toolCandidates)
      && (i.suggestion.toolCandidates as Array<{ name: string; params: string[] }>).length === 1,
    );
    if (singles.length === 0) {
      console.log('草稿中没有可自动补全的 tool_cli 单候选题（其余需人工审阅）。');
      return;
    }
    console.log(`自动补全 ${singles.length} 道 tool_cli 单候选题...\n`);
    let updated = 0;
    for (const item of singles) {
      const cands = item.suggestion.toolCandidates as Array<{ name: string; params: string[] }>;
      const sd = await prisma.scenarioDefinition.findUnique({ where: { id: item.id } });
      if (!sd) { console.log(`  [跳过] ${item.id} 不存在`); continue; }
      let req: Record<string, unknown> = {};
      try { req = sd.requirements ? JSON.parse(sd.requirements) : {}; } catch { /* ignore */ }
      // 防护：已有语义配置（must_not/must_call/sequence 等陷阱题）的题跳过自动补全，避免与题目意图冲突
      const semanticKeys = ['must_not', 'must_call', 'sequence', 'expectedActions', 'should_ask', 'missing_param'];
      const present = semanticKeys.filter((k) => req[k] !== undefined);
      if (present.length > 0) {
        console.log(`  [跳过] ${item.id} 已有语义配置（${present.join(',')}），可能存在意图冲突，需人工指定 tool`);
        continue;
      }
      const suggestion: Record<string, unknown> = { tool: cands[0].name };
      if (cands[0].params.length > 0) {
        suggestion.params = Object.fromEntries(cands[0].params.map((p) => [p, '']));
      }
      const merged = { ...req, ...suggestion };
      await prisma.scenarioDefinition.update({ where: { id: item.id }, data: { requirements: JSON.stringify(merged) } });
      console.log(`  [更新] ${item.id}: tool=${suggestion.tool} params=${JSON.stringify(suggestion.params ?? null)}`);
      updated++;
    }
    console.log(`\n=== 完成！自动补全 ${updated} 道题。剩余多候选/提取失败的题请人工编辑 config-gaps.json 后 --apply ===`);
    return;
  }

  // ===== 自动补全模式：agent 缺 paramPatterns 的动作 → 从"可用动作"列表提取参数名 =====
  if (autoApplyAgent) {
    const defs = await prisma.scenarioDefinition.findMany({ where: { dimension: 'agent_workflow' }, select: { id: true, promptTemplate: true, requirements: true } });
    console.log(`自动提取 agent 动作参数断言（${defs.length} 道题）...\n`);
    let updated = 0;
    let filled = 0;
    for (const d of defs) {
      let req: Record<string, unknown> = {};
      try { req = d.requirements ? JSON.parse(d.requirements) : {}; } catch { /* ignore */ }
      const actions = (req.expectedActions as Array<{ tool?: string; paramPatterns?: string[]; paramMode?: string }>) || [];
      if (actions.length === 0) continue;
      let changed = false;
      for (const a of actions) {
        if (!a.paramPatterns || a.paramPatterns.length === 0) {
          const params = extractAgentParams(d.promptTemplate, a.tool || '');
          if (params.length > 0) {
            a.paramPatterns = params;
            a.paramMode = 'any';
            changed = true;
            filled++;
          } else {
            console.log(`  [未提取] ${d.id} 工具 ${a.tool} 无参数信息`);
          }
        }
      }
      if (changed) {
        await prisma.scenarioDefinition.update({ where: { id: d.id }, data: { requirements: JSON.stringify(req) } });
        console.log(`  [更新] ${d.id}: ${actions.map((a) => `${a.tool}${a.paramPatterns?.length ? `[${a.paramPatterns.join('|')}]` : ''}`).join(' → ')}`);
        updated++;
      }
    }
    console.log(`\n=== 完成！更新 ${updated} 道 agent 题，填充 ${filled} 个动作参数断言 ===`);
    return;
  }

  // ===== 自动补全模式：IF 约束句 → 可执行约束（自动推断 type/check/patterns，无需人工） =====
  if (autoApplyIF) {
    if (!existsSync(OUTPUT_FILE)) {
      console.error(`未找到 ${OUTPUT_FILE}，请先运行审计生成草稿`);
      process.exit(1);
    }
    const data = JSON.parse(readFileSync(OUTPUT_FILE, 'utf8')) as { items: GapItem[] };
    const ifItems = data.items.filter((i) => i.dimension === 'instruction_following');
    console.log(`自动转换 ${ifItems.length} 道 IF 题的约束草稿...\n`);
    let updated = 0;
    let totalCons = 0;
    for (const item of ifItems) {
      const drafts = (item.suggestion.constraints as Array<{ description: string }>) || [];
      // 自动推断（低置信约束被丢弃，不产生错误检查）
      const cons: AutoConstraint[] = [];
      for (let i = 0; i < drafts.length; i++) {
        const c = autoConstraint(drafts[i].description, i);
        if (c) cons.push(c);
      }
      if (cons.length === 0) {
        console.log(`  [跳过] ${item.id} 约束无法可靠自动转换（${drafts.length} 条草稿均低置信）`);
        continue;
      }
      const sd = await prisma.scenarioDefinition.findUnique({ where: { id: item.id } });
      if (!sd) { console.log(`  [跳过] ${item.id} 不存在`); continue; }
      let req: Record<string, unknown> = {};
      try { req = sd.requirements ? JSON.parse(sd.requirements) : {}; } catch { /* ignore */ }
      const merged = { ...req, constraints: cons };
      await prisma.scenarioDefinition.update({ where: { id: item.id }, data: { requirements: JSON.stringify(merged) } });
      console.log(`  [更新] ${item.id}: 生成 ${cons.length}/${drafts.length} 条约束 ${cons.map((c) => c.type).join(',')}`);
      updated++;
      totalCons += cons.length;
    }
    console.log(`\n=== 完成！自动补全 ${updated} 道 IF 题（共 ${totalCons} 条约束）。未转换的复杂约束（表格格式/数值范围/顺序）保持未测量 ===`);
    return;
  }

  if (applyMode) {
    if (!existsSync(OUTPUT_FILE)) {
      console.error(`未找到 ${OUTPUT_FILE}，请先运行审计生成草稿`);
      process.exit(1);
    }
    const data = JSON.parse(readFileSync(OUTPUT_FILE, 'utf8')) as { items: GapItem[] };
    const toApply = data.items.filter((i) => i.apply === true);
    if (toApply.length === 0) {
      console.log('草稿中没有任何标记为 apply:true 的项。编辑 JSON 把需要补全的项设为 apply:true 后重跑 --apply。');
      return;
    }
    console.log(`准备写库 ${toApply.length} 项...`);
    let updated = 0;
    for (const item of toApply) {
      const sd = await prisma.scenarioDefinition.findUnique({ where: { id: item.id } });
      if (!sd) { console.log(`  [跳过] ${item.id} 不存在`); continue; }
      let req: Record<string, unknown> = {};
      try { req = sd.requirements ? JSON.parse(sd.requirements) : {}; } catch { /* ignore */ }

      // tool_cli：toolCandidates → 具体 tool/params
      if (Array.isArray(item.suggestion.toolCandidates)) {
        const cands = item.suggestion.toolCandidates as Array<{ name: string; params: string[] }>;
        if (!item.suggestion.tool) {
          if (cands.length === 1) {
            item.suggestion.tool = cands[0].name;
            if (cands[0].params.length > 0) {
              item.suggestion.params = Object.fromEntries(cands[0].params.map((p) => [p, '']));
            }
          } else {
            console.log(`  [跳过] ${item.id} 有 ${cands.length} 个候选工具，无法自动判定期望工具。请在 config-gaps.json 中为此项指定 "tool": "..." 后重跑 --apply`);
            continue;
          }
        }
        delete item.suggestion.toolCandidates;
      }
      // instruction_following：constraints 草稿若无 patterns 视为未完成
      if (Array.isArray(item.suggestion.constraints)) {
        const cons = item.suggestion.constraints as Array<{ check?: { patterns?: unknown[] } }>;
        const emptyPatterns = cons.filter((c) => !c.check?.patterns || c.check.patterns.length === 0);
        if (emptyPatterns.length > 0) {
          console.log(`  [跳过] ${item.id} 的约束草稿缺少 patterns（需人工补充检查模式）。请在 config-gaps.json 中补全后重跑 --apply`);
          continue;
        }
      }

      const merged = { ...req, ...item.suggestion };
      await prisma.scenarioDefinition.update({ where: { id: item.id }, data: { requirements: JSON.stringify(merged) } });
      console.log(`  [更新] ${item.id} (${item.dimension}): ${JSON.stringify(item.suggestion)}`);
      updated++;
    }
    console.log(`\n=== 完成！更新 ${updated} 道题 ===`);
    return;
  }

  // ===== 审计模式 =====
  const dims = dimFilter ? [dimFilter] : ['tool_cli_workflow', 'instruction_following', 'agent_workflow'];
  const items: GapItem[] = [];
  const summary: Record<string, { missing: number; drafted: number }> = {};

  for (const dim of dims) {
    const defs = await prisma.scenarioDefinition.findMany({ where: { dimension: dim }, select: { id: true, promptTemplate: true, requirements: true } });
    let missing = 0;
    let drafted = 0;

    for (const d of defs) {
      let req: Record<string, unknown> = {};
      try { req = d.requirements ? JSON.parse(d.requirements) : {}; } catch { /* ignore */ }

      if (dim === 'tool_cli_workflow') {
        const hasTool = typeof req.tool === 'string' && req.tool.length > 0;
        if (!hasTool) {
          missing++;
          const tools = extractToolCandidates(d.promptTemplate);
          // 候选工具与参数名写入 suggestion.toolCandidates；单工具时可直接 apply
          const suggestion: Record<string, unknown> = {
            toolCandidates: tools,
          };
          if (tools.length > 0) drafted++;
          items.push({
            id: d.id,
            dimension: dim,
            reason: 'tool 缺失',
            promptPreview: d.promptTemplate.slice(0, 160),
            suggestion,
          });
        }
      } else if (dim === 'instruction_following') {
        const hasConstraints = Array.isArray(req.constraints) && req.constraints.length > 0;
        if (!hasConstraints) {
          missing++;
          const drafts = extractConstraintDrafts(d.promptTemplate);
          const suggestion: Record<string, unknown> = {
            constraints: drafts.map((desc, i) => ({
              id: `c${i + 1}`,
              type: 'inclusion',
              description: desc,
              check: { patterns: [], requireAll: false },
            })),
          };
          if (drafts.length > 0) drafted++;
          items.push({ id: d.id, dimension: dim, reason: 'constraints 缺失', promptPreview: d.promptTemplate.slice(0, 160), suggestion });
        }
      } else if (dim === 'agent_workflow') {
        const actions = Array.isArray(req.expectedActions) ? req.expectedActions as Array<{ tool?: string; paramPatterns?: string[] }> : [];
        const missingParams = actions.filter((a) => !a.paramPatterns || a.paramPatterns.length === 0);
        if (missingParams.length > 0) {
          missing++;
          const pats = extractParamCandidates(d.promptTemplate, missingParams[0]?.tool || '');
          const suggestion: Record<string, unknown> = { expectedActions: actions.map((a) => ({ ...a, paramPatterns: a.paramPatterns?.length ? a.paramPatterns : pats })) };
          if (pats.length > 0) drafted++;
          items.push({ id: d.id, dimension: dim, reason: `${missingParams.length} 个动作缺 paramPatterns`, promptPreview: d.promptTemplate.slice(0, 160), suggestion });
        }
      }
    }
    summary[dim] = { missing, drafted };
  }

  const out = { generatedAt: new Date().toISOString(), summary, items };
  writeFileSync(OUTPUT_FILE, JSON.stringify(out, null, 2), 'utf8');
  console.log(`审计完成 → ${OUTPUT_FILE}\n`);
  console.log(`汇总: ${JSON.stringify(summary)}`);
  console.log(`说明: 工具名/参数/约束句为从 prompt 提取的建议草稿，需人工审阅后把项改为 apply:true 再运行 --apply 写库。`);
  console.log(`      草稿中 suggestion 为空表示自动提取失败，需人工补充。`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
