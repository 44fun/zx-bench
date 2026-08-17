// ============================================================
// 导出全部基准题到 data/scenarios/benchmark.json（开源可复现）
// 并为每题生成 scenarioHash（内容哈希，用于版本漂移检测）+ benchmark-meta.json
// 用法: node scripts/export-scenarios.mjs
// 前置: 数据库已就绪（apps/data/zxbench.db）
// ============================================================
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DB_PATH = process.env.ZXBENCH_DB_PATH || path.join(ROOT, 'apps/data/zxbench.db');
const OUT_DIR = path.join(ROOT, 'data/scenarios');
const OUT_FILE = path.join(OUT_DIR, 'benchmark.json');
const META_FILE = path.join(OUT_DIR, 'benchmark-meta.json');
const BENCHMARK_VERSION = '1.0.0';

const JSON_FIELDS = [
  'scoring', 'hiddenTests', 'requirements', 'tags',
  'toolSchema', 'expectedState', 'requiredInvariants',
  'allowedActions', 'forbiddenActions', 'requiredOrder',
];
const SKIP_FIELDS = ['createdAt', 'updatedAt', 'goldVerifiedAt'];

function parseJson(v) {
  if (v == null || v === '') return undefined;
  try { return JSON.parse(v); } catch { return v; }
}

function contentHash(o) {
  const stable = {};
  for (const [k, v] of Object.entries(o)) {
    if (SKIP_FIELDS.includes(k)) continue;
    if (k === 'scenarioHash') continue;
    stable[k] = v;
  }
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 16);
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA busy_timeout = 10000');
const rows = db.prepare('SELECT * FROM ScenarioDefinition ORDER BY dimension, id').all();

const out = rows.map((r) => {
  const o = {};
  for (const [k, v] of Object.entries(r)) {
    if (SKIP_FIELDS.includes(k)) continue;
    if (JSON_FIELDS.includes(k)) o[k] = parseJson(v);
    else o[k] = v;
  }
  o.scenarioHash = contentHash(o);
  return o;
});

const byDim = {};
for (const s of out) byDim[s.dimension] = (byDim[s.dimension] || 0) + 1;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(out, null, 1));
writeFileSync(META_FILE, JSON.stringify({
  version: BENCHMARK_VERSION,
  count: out.length,
  dimensions: byDim,
  generatedAt: new Date().toISOString(),
}, null, 1));

console.log('已导出 ' + out.length + ' 道题 → ' + OUT_FILE);
console.log('版本: v' + BENCHMARK_VERSION + ' | 元数据 → ' + META_FILE);
for (const [d, c] of Object.entries(byDim)) console.log('  ' + d + ': ' + c);
db.close();
