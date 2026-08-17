// 批量重跑 GLM-5.2 那 162 道「余额不足/429」失败的题目
// 用法: node rerun-failed.mjs
const BASE = 'http://127.0.0.1:3001';
const CONCURRENCY = 4;

async function main() {
  const runs = (await (await fetch(BASE + '/api/runs')).json()).data || [];
  const glm = runs.find(r => /glm-5\.2/i.test(r.modelConfig?.name || '') && r.status === 'completed');
  if (!glm) { console.error('GLM-5.2 completed run not found'); process.exit(1); }
  console.log('run:', glm.id, '| name:', glm.name);

  const detail = (await (await fetch(BASE + '/api/runs/' + glm.id)).json()).data || {};
  const results = detail.results || [];
  const failed = results.filter(r => /429|余额不足/.test(r.evidence?.[0] || ''));
  const ids = failed.map(r => r.scenarioId);
  console.log('429-failed scenarios to re-run:', ids.length);

  let idx = 0, done = 0, ok = 0, fail = 0;
  const startedAt = Date.now();
  const failedIds = [];

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= ids.length) return;
      const sid = ids[i];
      try {
        const res = await fetch(BASE + '/api/runs/' + glm.id + '/results/' + sid + '/retry', { method: 'POST' });
        const json = await res.json();
        if (json.success) ok++;
        else { fail++; failedIds.push(sid); console.log('[' + (i+1) + '/' + ids.length + '] ' + sid + ' FAIL: ' + (json.error || 'unknown')); }
      } catch (e) {
        fail++; failedIds.push(sid); console.log('[' + (i+1) + '/' + ids.length + '] ' + sid + ' ERROR: ' + String(e).slice(0,120));
      }
      done++;
      if (done % 10 === 0 || done === ids.length) {
        const min = ((Date.now() - startedAt) / 60000).toFixed(1);
        console.log('progress: ' + done + '/' + ids.length + ' done, ' + ok + ' ok, ' + fail + ' fail, ' + min + 'min');
      }
    }
  }

  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
  await Promise.all(workers);

  console.log('\n=== DONE ===');
  console.log('total:', done, '| ok:', ok, '| fail:', fail, '| elapsed:', ((Date.now()-startedAt)/60000).toFixed(1), 'min');
  if (failedIds.length) console.log('failed ids:', failedIds.join(','));
}

main().catch(e => { console.error(e); process.exit(1); });
