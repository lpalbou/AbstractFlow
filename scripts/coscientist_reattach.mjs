/**
 * Resilient re-attach poller for an already-running co-scientist run. Tolerates
 * transient gateway blips (ECONNREFUSED/timeout) instead of crashing, auto-
 * approves any tool waits, and writes the final output. Usage:
 *   DRIVE_TOKEN=... node scripts/coscientist_reattach.mjs <run_id> [out_path]
 */
import { writeFileSync } from 'node:fs';
const GATEWAY = 'http://127.0.0.1:8080';
const TOKEN = process.env.DRIVE_TOKEN || '';
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const RID = process.argv[2];
const OUT = process.argv[3] || '/tmp/coscientist_result.json';
const note = (s) => console.log(`[reattach] ${new Date().toISOString().slice(11, 19)} ${s}`);
if (!RID) { note('no run id'); process.exit(2); }

async function jSafe(url, init) {
  // Returns null on any transient failure instead of throwing.
  try {
    const res = await fetch(url, init);
    const t = await res.text();
    if (!res.ok) return null;
    try { return JSON.parse(t); } catch { return null; }
  } catch { return null; }
}

const approved = new Set();
async function autoApprove() {
  const kids = await jSafe(`${GATEWAY}/api/gateway/runs?parent_run_id=${RID}&limit=80`);
  const runs = [{ run_id: RID }, ...((kids && (kids.items || kids.runs)) || [])];
  for (const r of runs) {
    const cid = r.run_id || r.runId;
    if (!cid) continue;
    const s = await jSafe(`${GATEWAY}/api/gateway/runs/${cid}`);
    const w = s && (s.waiting || s.wait);
    if (!w) continue;
    const wk = w.wait_key || w.key || '';
    const isApproval = String(wk).startsWith('tool_approval') || (w.details && w.details.mode === 'approval_required');
    const k = `${cid}:${wk}`;
    if (isApproval && wk && !approved.has(k)) {
      approved.add(k);
      await jSafe(`${GATEWAY}/api/gateway/runs/${cid}/command`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ command_id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`, run_id: cid, type: 'resume', payload: { wait_key: wk, payload: { approved: true, auto_approved: true } } }),
      });
      note(`auto-approved ${wk} on ${cid.slice(0, 8)}`);
    }
  }
}

const deadline = Date.now() + 20 * 60_000;
let last = '';
for (;;) {
  await new Promise((r) => setTimeout(r, 5000));
  const s = await jSafe(`${GATEWAY}/api/gateway/runs/${RID}`, { headers: H });
  if (!s) { if (last !== 'blip') { note('gateway unreachable — waiting'); last = 'blip'; } continue; }
  const status = String(s.status || '').toLowerCase();
  const tag = `${status}@${s.current_node || ''}`;
  if (tag !== last) { note(tag); last = tag; }
  await autoApprove();
  if (['completed', 'failed', 'cancelled'].includes(status)) {
    note(`TERMINAL: ${status}`);
    const out = s.output ?? s.result ?? null;
    if (out && typeof out === 'object') {
      const ranked = out.ranked_hypotheses || [];
      note(`ranked ${ranked.length}, sources ${(out.sources || []).length}, cycles ${out.cycles}`);
      for (const h of ranked) {
        const rv = h.reviews || {};
        console.log(`   [Elo ${h.elo}] corr=${rv.correctness ?? '-'} nov=${rv.novelty ?? '-'} rev=${h.reviewed} | ${String(h.title || '').slice(0, 80)}`);
      }
      for (const sc of (out.sources || []).slice(0, 12)) console.log(`   src: ${String(sc.title || '').slice(0, 55)} | url="${String(sc.url || '')}"`);
      writeFileSync(OUT, JSON.stringify(out, null, 2));
      note(`full output -> ${OUT}`);
    } else {
      console.log('no output object:', JSON.stringify(s).slice(0, 400));
    }
    process.exit(status === 'completed' ? 0 : 1);
  }
  if (Date.now() > deadline) { note('TIMEOUT — durable run left running'); process.exit(2); }
}
