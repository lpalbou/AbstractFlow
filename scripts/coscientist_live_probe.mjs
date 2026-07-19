/**
 * Live proof for the improved co-scientist against OVH gpt-oss-120b.
 * Literature-grounded: the lit agent uses read-only web tools (safe
 * auto-approve set) — we auto-approve any wait as a belt. Polls to terminal
 * and prints ranked hypotheses + Elo + sources + overview.
 *
 * Usage: DRIVE_TOKEN=... node scripts/coscientist_live_probe.mjs "<research goal>" [max_cycles] [num_hyp]
 */
import { writeFileSync } from 'node:fs';
const GATEWAY = process.env.DRIVE_GATEWAY || 'http://127.0.0.1:8080';
const TOKEN = process.env.DRIVE_TOKEN || '';
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const note = (s) => console.log(`[coscientist] ${new Date().toISOString().slice(11, 19)} ${s}`);

async function j(url, init, attempt = 0) {
  const res = await fetch(url, init);
  // Transient guard: the gateway's auth-lockout window (429) killed a poller
  // mid-run once (2026-07-15) while the run itself completed fine. 429 is
  // rejected at the middleware (no side effects), so it is safe to retry for
  // ANY method; 5xx retries stay GET-only (a POST may have partially run).
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

const GOAL = process.argv[2] || 'best design for a dynamic self evolving memory graph for AI';
const MAX_CYCLES = Number(process.argv[3] || 2);
const NUM_HYP = Number(process.argv[4] || 4);

const start = await j(`${GATEWAY}/api/gateway/runs/start`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    bundle_id: 'co-scientist',
    bundle_version: '0.1.7',
    flow_id: 'co-scientist',
    input_data: {
      research_goal: GOAL,
      num_hypotheses: NUM_HYP,
      max_cycles: MAX_CYCLES,
      lit_iterations: 6,
      provider: 'endpoint:ovh-provider',
      model: 'gpt-oss-120b',
    },
  }),
});
const runId = start.run_id || start.runId;
note(`run ${runId} started (goal="${GOAL.slice(0, 60)}", cycles=${MAX_CYCLES})`);

const approved = new Set();
async function autoApprove(rid) {
  try {
    const kids = await j(`${GATEWAY}/api/gateway/runs?parent_run_id=${rid}&limit=50`, { headers: H }).catch(() => ({}));
    const runs = [{ run_id: rid }, ...((kids.items || kids.runs || kids || []) || [])];
    for (const r of runs) {
      const cid = r.run_id || r.runId;
      if (!cid) continue;
      const s = await j(`${GATEWAY}/api/gateway/runs/${cid}`, { headers: H }).catch(() => null);
      const w = s && (s.waiting || s.wait);
      if (!w) continue;
      const wk = w.wait_key || w.key || '';
      const isApproval = String(wk).startsWith('tool_approval') || (w.details && w.details.mode === 'approval_required');
      const k = `${cid}:${wk}`;
      if (isApproval && wk && !approved.has(k)) {
        approved.add(k);
        await j(`${GATEWAY}/api/gateway/runs/${cid}/command`, {
          method: 'POST', headers: H,
          body: JSON.stringify({ command_id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`, run_id: cid, type: 'resume', payload: { wait_key: wk, payload: { approved: true, auto_approved: true } } }),
        }).catch((e) => note(`approve failed: ${String(e).slice(0, 120)}`));
        note(`auto-approved ${wk} on ${cid.slice(0, 8)}`);
      }
    }
  } catch { /* best effort */ }
}

const deadline = Date.now() + 30 * 60_000;
let last = '';
for (;;) {
  await new Promise((r) => setTimeout(r, 5000));
  const s = await j(`${GATEWAY}/api/gateway/runs/${runId}`, { headers: H });
  const status = String(s.status || '').toLowerCase();
  const node = s.current_node || s.current_step || '';
  const tag = `${status}@${node}`;
  if (tag !== last) { note(`status: ${tag}`); last = tag; }
  await autoApprove(runId);
  if (['completed', 'failed', 'cancelled'].includes(status)) {
    note(`TERMINAL: ${status}`);
    const out = s.output ?? s.result ?? null;
    if (out && typeof out === 'object') {
      const ranked = out.ranked_hypotheses || [];
      note(`ranked hypotheses (${ranked.length}):`);
      for (const h of ranked) {
        console.log(`   [Elo ${h.elo ?? '?'}] ${String(h.title || '').slice(0, 110)}`);
      }
      const src = out.sources || [];
      note(`sources gathered: ${src.length}`);
      for (const sc of src.slice(0, 12)) console.log(`   - ${String(sc.title || '').slice(0, 70)} | ${String(sc.url || '').slice(0, 80)}`);
      console.log(`\n--- research_overview ---\n${String(out.research_overview || '').slice(0, 3000)}`);
      writeFileSync('/tmp/coscientist_result.json', JSON.stringify(out, null, 2));
      note('full output -> /tmp/coscientist_result.json');
    } else {
      console.log('output:', JSON.stringify(out).slice(0, 1500));
    }
    process.exit(status === 'completed' ? 0 : 1);
  }
  if (Date.now() > deadline) { note('TIMEOUT (30min) — leaving run durable'); process.exit(2); }
}
