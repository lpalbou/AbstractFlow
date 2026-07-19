/**
 * Live deep-research run on the same question, same substrate (OVH
 * gpt-oss-120b), for the co-scientist comparison. Auto-approves any tool
 * waits across the run tree (deep-investigate uses read-only web tools).
 *
 * Usage: DRIVE_TOKEN=... node scripts/deepresearch_live_probe.mjs "<request>" [effort]
 */
import { writeFileSync } from 'node:fs';
const GATEWAY = 'http://127.0.0.1:8080';
const TOKEN = process.env.DRIVE_TOKEN || '';
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const note = (s) => console.log(`[deep-research] ${new Date().toISOString().slice(11, 19)} ${s}`);

async function j(url, init) {
  const res = await fetch(url, init);
  const t = await res.text();
  let b;
  try { b = JSON.parse(t); } catch { b = t; }
  if (!res.ok) throw new Error(`${init?.method || 'GET'} ${url} -> ${res.status}: ${t.slice(0, 300)}`);
  return b;
}

const REQUEST = process.argv[2] || 'best design for a dynamic self evolving memory graph for AI';
const EFFORT = process.argv[3] || 'standard';

const start = await j(`${GATEWAY}/api/gateway/runs/start`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    bundle_id: 'deep-research',
    flow_id: 'deep-research',
    input_data: {
      request: REQUEST,
      effort: EFFORT,
      provider: 'endpoint:ovh-provider',
      model: 'gpt-oss-120b',
    },
  }),
});
const runId = start.run_id || start.runId;
note(`run ${runId} started (request="${REQUEST.slice(0, 60)}", effort=${EFFORT})`);

const approved = new Set();
async function autoApprove(rid) {
  try {
    const kids = await j(`${GATEWAY}/api/gateway/runs?parent_run_id=${rid}&limit=80`, { headers: H }).catch(() => ({}));
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
      console.log('output keys:', Object.keys(out).join(', '));
      const rep = out.report || out.markdown || out.answer || out.document || '';
      if (rep) console.log(`\n--- report ---\n${String(rep).slice(0, 3500)}`);
      writeFileSync('/tmp/deepresearch_result.json', JSON.stringify(out, null, 2));
      note('full output -> /tmp/deepresearch_result.json');
    } else {
      console.log('output:', JSON.stringify(out).slice(0, 1500));
    }
    process.exit(status === 'completed' ? 0 : 1);
  }
  if (Date.now() > deadline) { note('TIMEOUT (30min) — leaving run durable'); process.exit(2); }
}
