/**
 * Open-ended half of the meta-intelligence benchmark.
 *
 * Phase 1 (collect): run each arm on open questions (no single right answer);
 * store full answers. Phase 2 (judge): blind pairwise judgment of each meta
 * arm vs meta-baseline with POSITION SWAP (two judgments per pair, A/B then
 * B/A; a win counts only if the same answer wins both orders — order-flip
 * pairs count as ties). Judge = same model (a stronger judge would be better;
 * honesty requires saying the judge shares the answerers' blind spots).
 *
 * Usage:
 *   DRIVE_TOKEN=... node scripts/meta_benchmark_open.mjs collect [arms...]
 *   DRIVE_TOKEN=... node scripts/meta_benchmark_open.mjs judge
 * Data: /tmp/meta_open_answers.json, /tmp/meta_open_judgments.jsonl
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';

const GATEWAY = process.env.DRIVE_GATEWAY || 'http://192.168.1.146:8080';
const TOKEN = process.env.DRIVE_TOKEN || '';
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const PROVIDER = process.env.BENCH_PROVIDER || 'endpoint:ovh-provider';
const MODEL = process.env.BENCH_MODEL || 'gpt-oss-120b';
const ANSWERS = '/tmp/meta_open_answers.json';
const JUDGMENTS = '/tmp/meta_open_judgments.jsonl';

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

// Open questions spanning laurent's actual usage: design judgment, tradeoff
// analysis, planning, explanation. No verifiable single answer.
const QUESTIONS = [
  { id: 'memory-graph', q: 'What is the best design for a dynamic self-evolving memory graph for AI? Be specific about mechanisms and their tradeoffs.' },
  { id: 'api-version', q: 'Our public REST API needs breaking changes. Propose a versioning and migration strategy that minimizes pain for existing integrators, and defend it against the main alternatives.' },
  { id: 'onboard-eng', q: 'Design a 30-day onboarding plan for a senior engineer joining a 5-person startup with no documentation. What should they do, in what order, and why?' },
  { id: 'explain-entropy', q: 'Explain entropy to a smart 14-year-old in a way that connects thermodynamics and information theory without lying to them. Where do popular explanations go wrong?' },
  { id: 'ai-review', q: 'Should a small software team let an AI agent merge code changes without human review? Give a concrete policy recommendation with the conditions under which it changes.' },
  { id: 'city-transport', q: 'A mid-size city (500k people) has a fixed budget to improve transport: expand bus lanes, build protected bike infrastructure, or subsidize e-bikes. Recommend an allocation and justify it.' },
];

const ARMS = ['meta-consensus', 'meta-debate', 'meta-reflect', 'meta-perspectives', 'meta-deliberate'];

async function runArm(arm, prompt) {
  const t0 = Date.now();
  const start = await j(`${GATEWAY}/api/gateway/runs/start`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ bundle_id: arm, bundle_version: '0.1.0', flow_id: arm,
      input_data: { prompt, provider: PROVIDER, model: MODEL } }),
  });
  const runId = start.run_id || start.runId;
  for (let i = 0; i < 240; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await j(`${GATEWAY}/api/gateway/runs/${runId}`, { headers: H }).catch(() => null);
    if (st && (st.status === 'completed' || st.status === 'failed')) {
      const out = st.output || st.result || {};
      return { run_id: runId, status: st.status, seconds: Math.round((Date.now() - t0) / 1000), response: String(out.response || '') };
    }
  }
  return { run_id: runId, status: 'timeout', seconds: Math.round((Date.now() - t0) / 1000), response: '' };
}

if (process.argv[2] === 'collect') {
  const armsToRun = process.argv.slice(3).filter((a) => !a.startsWith('--'));
  const arms = armsToRun.length ? armsToRun : ['meta-baseline', ...ARMS];
  const store = existsSync(ANSWERS) ? JSON.parse(readFileSync(ANSWERS, 'utf8')) : {};
  for (const item of QUESTIONS) {
    for (const arm of arms) {
      const key = `${arm}::${item.id}`;
      if (store[key]?.status === 'completed') continue;
      try {
        store[key] = await runArm(arm, item.q);
        console.log(`[collect] ${key}: ${store[key].status} ${store[key].seconds}s ${store[key].response.length} chars`);
      } catch (e) {
        store[key] = { status: 'error', error: String(e).slice(0, 200) };
        console.log(`[collect] ${key}: ERROR`);
      }
      writeFileSync(ANSWERS, JSON.stringify(store, null, 1));
    }
  }
  console.log('[collect] done');
} else if (process.argv[2] === 'judge') {
  const store = JSON.parse(readFileSync(ANSWERS, 'utf8'));
  if (existsSync(JUDGMENTS)) writeFileSync(JUDGMENTS, '');
  const judgeOnce = async (question, ansA, ansB) => {
    const prompt = [
      'You are judging two answers to the same question. Pick the better one.',
      '', '# Question', question,
      '', '# Answer A', ansA,
      '', '# Answer B', ansB,
      '', '# Judge',
      'Criteria: directly addresses the question; correctness/soundness of reasoning; specificity (concrete mechanisms/numbers/steps over platitudes); honest handling of tradeoffs and uncertainty; clarity. Length alone is NOT quality — penalize padding.',
      'Respond with EXACTLY one line: VERDICT: A or VERDICT: B or VERDICT: TIE, then one sentence why.',
    ].join('\n');
    const start = await j(`${GATEWAY}/api/gateway/runs/start`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ bundle_id: 'meta-baseline', bundle_version: '0.1.0', flow_id: 'meta-baseline',
        input_data: { prompt, provider: PROVIDER, model: MODEL } }),
    });
    const runId = start.run_id || start.runId;
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const st = await j(`${GATEWAY}/api/gateway/runs/${runId}`, { headers: H }).catch(() => null);
      if (st && (st.status === 'completed' || st.status === 'failed')) {
        const resp = String((st.output || st.result || {}).response || '');
        const m = resp.match(/VERDICT:\s*(A|B|TIE)/i);
        return m ? m[1].toUpperCase() : 'UNPARSED';
      }
    }
    return 'TIMEOUT';
  };
  for (const item of QUESTIONS) {
    const base = store[`meta-baseline::${item.id}`];
    if (!base || base.status !== 'completed') continue;
    for (const arm of ARMS) {
      const meta = store[`${arm}::${item.id}`];
      if (!meta || meta.status !== 'completed') continue;
      // order 1: A=meta, B=baseline; order 2 swapped
      const v1 = await judgeOnce(item.q, meta.response, base.response);
      const v2 = await judgeOnce(item.q, base.response, meta.response);
      // consistent win: meta wins order1 as A AND order2 as B
      let outcome = 'tie';
      if (v1 === 'A' && v2 === 'B') outcome = 'meta';
      else if (v1 === 'B' && v2 === 'A') outcome = 'baseline';
      const rec = { item: item.id, arm, order1: v1, order2: v2, outcome };
      appendFileSync(JUDGMENTS, JSON.stringify(rec) + '\n');
      console.log(`[judge] ${arm} ${item.id}: ${v1}/${v2} -> ${outcome}`);
    }
  }
  console.log('[judge] done');
} else {
  console.log('usage: meta_benchmark_open.mjs collect|judge');
}
