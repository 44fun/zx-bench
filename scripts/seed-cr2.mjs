// ============================================================
// Seed 脚本：导入 CR2 编程能力测试题集（50 题，多语言）
// 用法：node scripts/seed-cr2.mjs [--reset]
//   --reset  先删除所有 CR2- 开头的题目再导入
// 前置：服务已启动于 http://localhost:3000
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SCENARIOS_DIR = path.join(ROOT, 'data', 'scenarios');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const RESET = process.argv.includes('--reset');

// 收集所有 cr2-*.json
const files = fs.readdirSync(SCENARIOS_DIR).filter((f) => f.startsWith('cr2-') && f.endsWith('.json'));
if (files.length === 0) {
  console.error('未找到 cr2-*.json 文件');
  process.exit(1);
}

const scenarios = [];
for (const f of files) {
  const raw = fs.readFileSync(path.join(SCENARIOS_DIR, f), 'utf8');
  const arr = JSON.parse(raw);
  scenarios.push(...arr);
  console.log(`  读取 ${f}: ${arr.length} 题`);
}
console.log(`\n共加载 ${scenarios.length} 道题目\n`);

// 统计
const byLang = {};
const byDiff = {};
const byCat = {};
for (const s of scenarios) {
  byLang[s.language] = (byLang[s.language] || 0) + 1;
  byDiff[s.difficulty] = (byDiff[s.difficulty] || 0) + 1;
  const isTrap = s.expectedVerdict === 'no_bug';
  const cat = isTrap ? 'trap' : s.category;
  byCat[cat] = (byCat[cat] || 0) + 1;
}
console.log('语言分布:', JSON.stringify(byLang, null, 0));
console.log('难度分布:', JSON.stringify(byDiff, null, 0));
console.log('---\n');

// 可选：先删除已有 CR2 题目
if (RESET) {
  const existing = await fetch(`${BASE}/api/scenarios`).then((r) => r.json());
  const cr2 = (existing.data || []).filter((s) => s.id.startsWith('CR2-'));
  console.log(`--reset: 删除 ${cr2.length} 道已有 CR2 题目`);
  for (const s of cr2) {
    await fetch(`${BASE}/api/scenarios/${s.id}`, { method: 'DELETE' });
  }
}

// 导入
let ok = 0;
let fail = 0;
for (const s of scenarios) {
  try {
    const res = await fetch(`${BASE}/api/scenarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    });
    const body = await res.json();
    if (body.success) {
      ok++;
    } else {
      fail++;
      console.error(`  ✗ ${s.id}: ${body.error}`);
    }
  } catch (err) {
    fail++;
    console.error(`  ✗ ${s.id}: ${err.message}`);
  }
}

console.log(`\n导入完成：成功 ${ok} / 失败 ${fail} / 总计 ${scenarios.length}`);
process.exit(fail > 0 ? 1 : 0);
