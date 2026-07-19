/**
 * Meta-intelligence benchmark: do co-orchestrated deliberation workflows beat
 * an isolated LLM call, and by how much?
 *
 * Arms: meta-baseline (control: ONE direct llm_call) vs the five meta flows.
 * Every arm is an agent.v1 flow on the SAME gateway, model, and system
 * prompt — the only variable is the orchestration.
 *
 * Task set (verifiable): trap-style reasoning items with objectively
 * checkable answers. Graded by regex/number extraction on the FINAL response
 * (models may show work; we grade the committed answer).
 *
 * Usage:
 *   DRIVE_TOKEN=... node scripts/meta_benchmark.mjs [arms...] [--items=a,b] [--out=path]
 * Defaults: all six arms, all items, out=/tmp/meta_benchmark_results.jsonl
 * Results are APPENDED as JSONL so partial runs accumulate; the report
 * script aggregates by (arm,item) taking the LAST record.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const GATEWAY = process.env.DRIVE_GATEWAY || 'http://192.168.1.146:8080';
const TOKEN = process.env.DRIVE_TOKEN || '';
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const PROVIDER = process.env.BENCH_PROVIDER || 'endpoint:ovh-provider';
const MODEL = process.env.BENCH_MODEL || 'gpt-oss-120b';

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

// --- verifiable items ------------------------------------------------------
// check(text) grades the FINAL committed answer. Graders accept the number/
// keyword in prose ("27 sheep", "**27**"). Items chosen to be trap-prone:
// the naive first instinct is wrong, so deliberation has room to help.
const norm = (s) => String(s || '').toLowerCase().replace(/[*_`]/g, '');
// Grade the FINAL: line when present (the harness appends the anchor to every
// prompt); fall back to the whole text for pre-anchor results. Scoping the
// trap-negations to the committed line is what makes them safe (adversary
// P0: whole-text negations penalized arms for EXPLAINING the trap).
const commit = (s) => {
  const m = String(s || '').match(/^\s*FINAL:\s*(.+)$/im);
  return m ? m[1] : String(s || '');
};
const hasNum = (s, n) => new RegExp(`(^|[^\\d.])${n}([^\\d]|$)`).test(norm(commit(s)).replace(/[\u202f,\u00a0]/g, ''));
const ITEMS = [
  {
    id: 'sheep',
    prompt: 'A farmer has 17 sheep. All but 9 run away. Then he buys twice as many sheep as remain. How many sheep does he have now? Give the final number.',
    check: (s) => hasNum(s, 27),
    trap: 'read "all but 9" as 17-9=8; forget to add the bought sheep',
  },
  {
    id: 'bat-ball',
    prompt: 'A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost, in cents? Give the final number of cents.',
    check: (s) => hasNum(s, 5) && !hasNum(s, 10),
    trap: 'the intuitive 10 cents',
  },
  {
    id: 'widgets',
    prompt: 'If 5 machines take 5 minutes to make 5 widgets, how long would 100 machines take to make 100 widgets? Answer in minutes.',
    check: (s) => hasNum(s, 5) && !/100\s*minutes/.test(norm(s)),
    trap: 'answer 100 minutes',
  },
  {
    id: 'lily-pads',
    prompt: 'A patch of lily pads doubles in size every day. It takes 48 days to cover the whole lake. How many days to cover half the lake? Give the final number.',
    check: (s) => hasNum(s, 47) && !hasNum(s, 24),
    trap: 'answer 24 (half of 48)',
  },
  {
    id: 'race-position',
    prompt: 'In a race you overtake the runner in second place. What position are you in now? One word answer plus one sentence why.',
    // Committed-line check only: "second, not first" must pass (the old
    // whole-text order-sensitive negation rejected that correct phrasing).
    check: (s) => /second|2nd|deuxi[eè]me/.test(norm(commit(s))),
    trap: 'answer "first"',
  },
  {
    id: 'months-28',
    prompt: 'How many months of the year have 28 days? Give the final number.',
    check: (s) => hasNum(s, 12) && !/(^|[^\d])1([^\d]|$)(?![\s\S]*12)/.test(norm(s)),
    trap: 'answer 1 (February)',
  },
  {
    id: 'socks',
    prompt: 'A drawer has 12 black socks and 12 white socks mixed. It is pitch dark. What is the minimum number of socks you must take out to be CERTAIN you have a matching pair? Give the final number.',
    check: (s) => hasNum(s, 3),
    trap: 'answer 13 or 2',
  },
  {
    id: 'brothers-sisters',
    prompt: 'A girl has as many brothers as sisters, but each brother has only half as many brothers as sisters. How many brothers and how many sisters are in the family? End with both, e.g. "N brothers, M sisters".',
    // Order-aware: presence of {3,4} alone cannot distinguish the swapped
    // wrong answer (adversary 8b); demand the pairing on the committed line.
    check: (s) => /3\s*(brothers|boys)/.test(norm(commit(s))) && /4\s*(sisters|girls)/.test(norm(commit(s))),
    trap: 'algebra slip or swap: correct is 3 brothers, 4 sisters',
  },
  {
    id: 'dead-fish',
    prompt: 'There are 10 fish in a sealed tank. 3 of them drown. How many fish are in the tank? Give the final number and a one-line explanation.',
    check: (s) => hasNum(s, 10),
    trap: 'compute 10-3=7; fish do not drown and nothing leaves the tank',
  },
  {
    id: 'interval-chimes',
    prompt: 'A clock takes 6 seconds to strike 3 o\'clock (3 chimes). How many seconds does it take to strike 9 o\'clock (9 chimes), assuming the same pace? Give the final number.',
    check: (s) => hasNum(s, 24) && !hasNum(s, 18),
    trap: 'answer 18 (proportional); intervals: 2 gaps in 6s -> 3s/gap; 8 gaps = 24s',
  },
  // birthday-days REMOVED (adversary finding 8a): the item was self-
  // contradictory (a 12-hour analog alarm cannot encode "9am") with a
  // distractor preamble from a different riddle — all six arms answered 13
  // defensibly; zero discrimination. Replaced with a clean interval trap.
  {
    id: 'alarm-clock',
    prompt: 'A man goes to bed at 8 in the evening, winds up his old mechanical 12-hour alarm clock, and sets the alarm hand to 9. How many hours does he sleep before the alarm rings? Give the final number.',
    check: (s) => hasNum(s, 1),
    trap: 'answer 13; a wound 12-hour mechanical alarm rings at the NEXT time the hands reach 9, i.e. 9pm',
  },
  {
    id: 'rope-ladder',
    prompt: 'A rope ladder hangs over the side of a ship; the rungs are 30cm apart and 10 rungs are above the water. The tide rises 90cm. How many rungs are above the water now? Give the final number.',
    check: (s) => hasNum(s, 10) && !hasNum(s, 7),
    trap: 'answer 7; the ship (and ladder) rises with the tide',
  },
];

// --- run one (arm, item) ----------------------------------------------------
async function runOne(arm, item) {
  const t0 = Date.now();
  // FINAL-anchor (adversary rec): give the grader a line the ANSWERER
  // controls, so trap-negation grading never penalizes explaining the trap.
  // Applied harness-side only — flows stay generic. Note: results collected
  // before 2026-07-16T03:30Z lack the anchor; grade those with the
  // committed-answer extractor + manual adjudication instead.
  const prompt = `${item.prompt}\n\nEnd your response with a line "FINAL: <your answer>".`;
  const start = await j(`${GATEWAY}/api/gateway/runs/start`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      bundle_id: arm, bundle_version: '0.1.0', flow_id: arm,
      input_data: { prompt, provider: PROVIDER, model: MODEL },
    }),
  });
  const runId = start.run_id || start.runId;
  let final = null;
  for (let i = 0; i < 180; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const st = await j(`${GATEWAY}/api/gateway/runs/${runId}`, { headers: H }).catch(() => null);
    if (!st) continue;
    if (st.status === 'completed' || st.status === 'failed' || st.status === 'cancelled') { final = st; break; }
  }
  const seconds = (Date.now() - t0) / 1000;
  if (!final) return { arm, item: item.id, run_id: runId, status: 'timeout', seconds };
  const out = final.output || final.result || {};
  const response = String(out.response || '');
  // token usage: sum llm_call usage across the run ledger
  let tokensIn = 0, tokensOut = 0, calls = 0;
  try {
    const led = await j(`${GATEWAY}/api/gateway/runs/${runId}/ledger?limit=500`, { headers: H });
    const recs = led.records || led.items || (Array.isArray(led) ? led : []);
    for (const r of recs) {
      const u = r?.result?.usage || r?.result?.meta?.usage || null;
      if (u && r?.status === 'completed') {
        tokensIn += Number(u.input_tokens ?? u.prompt_tokens ?? 0);
        tokensOut += Number(u.output_tokens ?? u.completion_tokens ?? 0);
        calls += 1;
      }
    }
  } catch { /* usage optional */ }
  return {
    arm, item: item.id, run_id: runId, status: final.status, seconds: Math.round(seconds),
    correct: final.status === 'completed' ? Boolean(item.check(response)) : false,
    tokens_in: tokensIn, tokens_out: tokensOut, llm_calls: calls,
    response_head: response.slice(0, 220),
  };
}

// --- main --------------------------------------------------------------------
const args = process.argv.slice(2);
const OUT = (args.find((a) => a.startsWith('--out=')) || '--out=/tmp/meta_benchmark_results.jsonl').slice(6);
const itemsArg = args.find((a) => a.startsWith('--items='));
const only = itemsArg ? itemsArg.slice(8).split(',') : null;
const arms = args.filter((a) => !a.startsWith('--'));
const ARMS = arms.length ? arms : ['meta-baseline', 'meta-consensus', 'meta-debate', 'meta-reflect', 'meta-perspectives', 'meta-deliberate'];
const items = only ? ITEMS.filter((i) => only.includes(i.id)) : ITEMS;

// Resume: skip (arm,item) pairs that already have a terminal record (the
// runner is killed-and-relaunched safe; sandbox shells kill nohup children).
const done = new Set();
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.status === 'completed') done.add(`${r.arm}::${r.item}`);
    } catch { /* skip bad line */ }
  }
}

console.log(`[bench] ${ARMS.length} arms x ${items.length} items -> ${OUT} (model ${MODEL}; ${done.size} already done)`);
for (const item of items) {
  for (const arm of ARMS) {
    if (done.has(`${arm}::${item.id}`)) continue;
    try {
      const rec = await runOne(arm, item);
      appendFileSync(OUT, JSON.stringify(rec) + '\n');
      console.log(`[bench] ${arm} ${item.id}: ${rec.status} correct=${rec.correct} ${rec.seconds}s in=${rec.tokens_in} out=${rec.tokens_out}`);
    } catch (e) {
      const rec = { arm, item: item.id, status: 'error', error: String(e).slice(0, 200) };
      appendFileSync(OUT, JSON.stringify(rec) + '\n');
      console.log(`[bench] ${arm} ${item.id}: ERROR ${String(e).slice(0, 120)}`);
    }
  }
}
console.log('[bench] done');
