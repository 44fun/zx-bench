// 从 cc switch 配置导入模型到 zx-bench
// 用法: node scripts/import-cc-models.mjs   (需 zx-bench server 运行在 127.0.0.1:3001)
import { readFileSync } from 'node:fs';

const CC_SETTINGS = process.env.CC_SETTINGS || 'C:\\Users\\Wayne Wu\\claude\\settings.json';
const ZXBENCH_API = process.env.ZXBENCH_API || 'http://127.0.0.1:3001/api/models';
const PROXY_BASE = 'http://127.0.0.1:15721/v1';

// cc switch 的 4 个逻辑档位 -> settings.json env 中的实际模型 slug 字段
const SLOTS = {
  fable: 'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME',
  haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
  opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
  sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
};

function loadSlugs() {
  const cfg = JSON.parse(readFileSync(CC_SETTINGS, 'utf8'));
  const env = cfg.env || {};
  const out = [];
  for (const [slot, key] of Object.entries(SLOTS)) {
    const name = env[key];
    if (name) out.push({ slot, name });
  }
  return out;
}

async function importOne({ slot, name }) {
  const payload = {
    name,
    displayName: `${slot} / ${name}`,
    provider: 'openai',
    baseUrl: PROXY_BASE,
    apiKey: 'PROXY_MANAGED',
    modelType: 'tested',
    reasoningModel: false,
    defaultParams: { temperature: 0, maxTokens: 8192 },
  };
  const res = await fetch(ZXBENCH_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { slot, name, ok: res.ok, data };
}

const models = loadSlugs();
console.log(`从 cc switch 读取到 ${models.length} 个模型映射`);
for (const m of models) {
  try {
    const r = await importOne(m);
    console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.slot}: ${r.name} -> ${JSON.stringify(r.data).slice(0, 200)}`);
  } catch (e) {
    console.log(`ERR  ${m.slot}: ${e.message}`);
  }
}
