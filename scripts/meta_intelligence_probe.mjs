/**
 * Live probe/benchmark primitive for the meta-intelligence family.
 * Starts ONE agent.v1-shaped run (any of the five meta flows — or basic
 * baseline via a bare flow) and polls to terminal, printing response + meta
 * + usage. Reused by the benchmark harness.
 *
 * Usage: DRIVE_TOKEN=... node scripts/meta_intelligence_probe.mjs <bundle_id> "<prompt>" [provider] [model]
 */
const GATEWAY = process.env.DRIVE_GATEWAY || 'http://192.168.1.146:8080';
const TOKEN = process.env.DRIVE_TOKEN || '';
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function j(url, init, attempt = 0) {
  const res = await fetch(url, init);
  const isGet = !init || !init.method || init.method === 'GET';
  if ((res.status === 429 || (res.status >= 500 && isGet)) && attempt < 6) {
    await new Promise((r) => setTimeout(r, Math.min(60000, 5000 * (attempt + 1))));
    return j(url, init, attempt + 1);
  }
  const t = await res.text();
  let b;
  try { b = JSON.parse(t); } catch { b = t; }
  if (!res.ok) throw new Error(`${init?.method || 'GET'} ${url} -> ${res.status}: ${t.slice(0, 300)}`);
  return b;
}

const BUNDLE = process.argv[2] || 'meta-consensus';
const PROMPT = process.argv[3] || 'Which weighs more: a kilogram of feathers spread over a football field, or a kilogram of steel in a box? Explain briefly.';
const PROVIDER = process.argv[4] || 'endpoint:ovh-provider';
const MODEL = process.argv[5] || 'gpt-oss-120b';

const t0 = Date.now();
const start = await j(`${GATEWAY}/api/gateway/runs/start`, {
  method: 'POST', headers: H,
  body: JSON.stringify({
    bundle_id: BUNDLE, bundle_version: '0.1.0', flow_id: BUNDLE,
    input_data: { prompt: PROMPT, provider: PROVIDER, model: MODEL },
  }),
});
const runId = start.run_id || start.runId;
console.log(`[probe] ${BUNDLE} run ${runId}`);

let final = null;
for (let i = 0; i < 240; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const st = await j(`${GATEWAY}/api/gateway/runs/${runId}`, { headers: H });
  const s = st.status;
  if (s === 'completed' || s === 'failed' || s === 'cancelled') { final = st; break; }
}
if (!final) throw new Error('timeout');
const secs = ((Date.now() - t0) / 1000).toFixed(0);
const out = final.output || final.result || {};
console.log(`[probe] status=${final.status} in ${secs}s`);
console.log('--- response ---');
console.log(String(out.response || '').slice(0, 4000));
console.log('--- meta (stage sizes) ---');
const meta = out.meta || {};
const stages = meta.stages || {};
for (const [k, v] of Object.entries(stages)) {
  console.log(`  ${k}: ${typeof v === 'string' ? v.length + ' chars' : JSON.stringify(v).length + ' chars (json)'}`);
}
console.log(JSON.stringify({ run_id: runId, status: final.status, seconds: Number(secs), workflow: meta.workflow || BUNDLE }));
