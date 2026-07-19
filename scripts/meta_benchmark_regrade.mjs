/**
 * Re-grade the meta benchmark on the COMMITTED answer, not the whole text.
 *
 * The v1 graders' negative clauses (e.g. "!hasNum(10)" on bat-ball) marked
 * correct answers WRONG whenever the response explained the trap ("the
 * intuitive 10 cents is wrong") — a bias hitting exactly the verbose meta
 * arms. This pass re-fetches every run's full response and grades the
 * committed answer: the first number in a bold/boxed/"Answer:" position,
 * falling back to the first number-bearing line.
 *
 * Usage: DRIVE_TOKEN=... node scripts/meta_benchmark_regrade.mjs
 * Reads /tmp/meta_benchmark_results.jsonl, writes /tmp/meta_benchmark_regraded.jsonl
 */
import { readFileSync, appendFileSync, writeFileSync, existsSync } from 'node:fs';

const GATEWAY = process.env.DRIVE_GATEWAY || 'http://192.168.1.146:8080';
const TOKEN = process.env.DRIVE_TOKEN || '';
const H = { Authorization: `Bearer ${TOKEN}` };
const OUT = '/tmp/meta_benchmark_regraded.jsonl';

async function j(url, attempt = 0) {
  const res = await fetch(url, { headers: H });
  if ((res.status === 429 || res.status >= 500) && attempt < 6) {
    await new Promise((r) => setTimeout(r, Math.min(60000, 5000 * (attempt + 1))));
    return j(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

// --- committed-answer extraction --------------------------------------------
// Strategy: scan in priority order; the first hit is the committed answer.
//  1. \boxed{N}
//  2. **N** or **N unit** (first bold number)
//  3. "answer[:\s]" line -> first number on it
//  4. first line of the response containing a number
// Numbers normalize thin/nbsp spaces; decimals kept (bat-ball may say 0.05).
function committedNumbers(text) {
  const t = String(text || '').replace(/[\u202f\u00a0]/g, ' ');
  const num = /-?\d+(?:\.\d+)?/g;
  const pick = (s) => (s.match(num) || []).map(Number);
  const boxed = t.match(/\\boxed\{([^}]*)\}/);
  if (boxed && pick(boxed[1]).length) return pick(boxed[1]);
  const bold = t.match(/\*\*([^*]{0,80}?\d[^*]{0,80}?)\*\*/);
  if (bold && pick(bold[1]).length) return pick(bold[1]);
  for (const line of t.split('\n')) {
    if (/answer\s*[:\u2014-]/i.test(line) && pick(line).length) return pick(line);
  }
  for (const line of t.split('\n')) {
    const ns = pick(line);
    if (ns.length) return ns;
  }
  return [];
}

const CHECKS = {
  sheep: (t) => committedNumbers(t).includes(27),
  'bat-ball': (t) => {
    const ns = committedNumbers(t);
    return ns.includes(5) || ns.includes(0.05);
  },
  widgets: (t) => committedNumbers(t).includes(5),
  'lily-pads': (t) => committedNumbers(t).includes(47),
  'race-position': (t) => {
    const head = String(t || '').toLowerCase().slice(0, 400);
    return /second|2nd|deuxi[eè]me/.test(head) && !/\bfirst\b(?![\s\S]*second)/.test(head);
  },
  'months-28': (t) => committedNumbers(t).includes(12),
  socks: (t) => committedNumbers(t).includes(3),
  'brothers-sisters': (t) => {
    const ns = committedNumbers(t);
    // committed line may carry only one of the two; accept either order,
    // require both somewhere in the first 600 chars as a belt
    const head = String(t || '').slice(0, 600);
    const hn = (n) => new RegExp(`(^|[^\\d.])${n}([^\\d]|$)`).test(head);
    return (ns.includes(3) || ns.includes(4)) && hn(3) && hn(4);
  },
  'dead-fish': (t) => committedNumbers(t).includes(10),
  'interval-chimes': (t) => committedNumbers(t).includes(24),
  'birthday-days': (t) => committedNumbers(t).includes(1),
  'rope-ladder': (t) => committedNumbers(t).includes(10),
};

// --- main --------------------------------------------------------------------
const cells = {};
for (const line of readFileSync('/tmp/meta_benchmark_results.jsonl', 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  cells[`${r.arm}::${r.item}`] = r;
}
if (existsSync(OUT)) writeFileSync(OUT, '');

for (const key of Object.keys(cells)) {
  const r = cells[key];
  if (r.status !== 'completed' || !r.run_id) {
    appendFileSync(OUT, JSON.stringify({ ...r, correct_v2: false, grade_note: 'not completed' }) + '\n');
    continue;
  }
  const st = await j(`${GATEWAY}/api/gateway/runs/${r.run_id}`);
  const response = String((st.output || st.result || {}).response || '');
  const check = CHECKS[r.item];
  const ok = check ? Boolean(check(response)) : false;
  const changed = ok !== Boolean(r.correct);
  appendFileSync(OUT, JSON.stringify({ ...r, correct_v2: ok, response_full_len: response.length, grade_changed: changed }) + '\n');
  if (changed) console.log(`[regrade] ${r.arm} ${r.item}: ${r.correct} -> ${ok}`);
}
console.log('[regrade] done ->', OUT);
