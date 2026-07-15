/**
 * Live proof of the coding-agent workflow: start a real run against the
 * gateway, auto-approve the builder/verifier tool calls (execute_command is
 * approval-gated), poll to terminal, and report the gate evidence from the
 * run tree (builder ran, verify subflow ran build/execute/analyze_code, a
 * structured verdict came back, loop produced a report).
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

const GATEWAY = 'http://127.0.0.1:8080';
const TOKEN = process.env.DRIVE_TOKEN || '';
const WS = process.env.CODING_WS || '/Users/albou/tmp/coding-agent-run';
const MAX_ROUNDS = Number(process.env.CODING_ROUNDS || 2);
const REQUEST = process.env.CODING_REQUEST ||
  'Write a Python file solution.py with a function factorial(n) returning n! (iterative, n>=0) and a __main__ block that prints factorial(5). It must run with: python3 solution.py';
const note = (s) => console.log(`[coding-run] ${s}`);
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function j(url, init) {
  const res = await fetch(url, init);
  const txt = await res.text();
  let body; try { body = JSON.parse(txt); } catch { body = txt; }
  if (!res.ok) throw new Error(`${init?.method || 'GET'} ${url} -> ${res.status}: ${txt.slice(0, 300)}`);
  return body;
}

// Fresh workspace.
rmSync(WS, { recursive: true, force: true });
mkdirSync(WS, { recursive: true });
note(`workspace: ${WS}`);

const start = await j(`${GATEWAY}/api/gateway/runs/start`, {
  method: 'POST', headers: H,
  body: JSON.stringify({
    bundle_id: 'coding-agent', bundle_version: '0.1.0', flow_id: 'coding-agent',
    input_data: {
      request: REQUEST,
      workspace_root: WS,
      workspace_access_mode: 'all_except_ignored',
      build_command: 'python3 -m py_compile solution.py',
      run_command: 'python3 solution.py',
      max_rounds: MAX_ROUNDS,
    },
  }),
});
const runId = start.run_id;
note(`run started: ${runId}`);

async function listTree(root) {
  // Collect the root + descendants (best-effort) for gate evidence.
  const seen = new Map();
  const queue = [root];
  while (queue.length) {
    const rid = queue.shift();
    if (seen.has(rid)) continue;
    try {
      const r = await j(`${GATEWAY}/api/gateway/runs/${rid}`, { headers: H });
      seen.set(rid, r);
      const kids = await j(`${GATEWAY}/api/gateway/runs?parent_run_id=${rid}&limit=50`, { headers: H }).catch(() => ({}));
      for (const k of (kids.items || kids.runs || [])) if (k.run_id) queue.push(k.run_id);
    } catch { /* ignore */ }
  }
  return seen;
}

async function ledger(rid) {
  try { const r = await j(`${GATEWAY}/api/gateway/runs/${rid}/ledger`, { headers: H }); return r.items || r.records || r || []; }
  catch { return []; }
}

const deadline = Date.now() + 14 * 60_000;
const approved = new Set();
let finalStatus = '';
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 4000));
  const tree = await listTree(runId);
  // Auto-approve any waiting tool-approval across the whole tree.
  for (const [rid, r] of tree) {
    const w = r.waiting;
    if (r.status === 'waiting' && w && typeof w === 'object') {
      const wk = w.wait_key || '';
      const isApproval = String(wk).startsWith('tool_approval') ||
        (w.details && w.details.mode === 'approval_required');
      const key = `${rid}:${wk}`;
      if (isApproval && wk && !approved.has(key)) {
        approved.add(key);
        try {
          await j(`${GATEWAY}/api/gateway/commands`, {
            method: 'POST', headers: H,
            body: JSON.stringify({ command_id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`, run_id: rid, type: 'resume', payload: { wait_key: wk, payload: { approved: true, auto_approved: true } } }),
          });
          note(`auto-approved ${wk} on ${rid.slice(0, 8)}`);
        } catch (e) { note(`approve failed: ${String(e).slice(0, 120)}`); }
      }
    }
  }
  const root = tree.get(runId);
  const st = root?.status || '';
  if (st === 'completed' || st === 'failed' || st === 'cancelled') { finalStatus = st; break; }
}
note(`root terminal status: ${finalStatus || '#TIMEOUT'}`);

// Evidence sweep across the tree ledgers.
const tree = await listTree(runId);
let sawExecuteCmd = false, sawAnalyze = false, sawBuilder = false, sawVerifier = false, sawSubflow = false;
const cmds = [];
for (const [rid] of tree) {
  const recs = await ledger(rid);
  for (const rec of recs) {
    const s = JSON.stringify(rec);
    if (/"execute_command"/.test(s)) { sawExecuteCmd = true; const m = s.match(/"command"\s*:\s*"([^"]{0,80})/); if (m) cmds.push(m[1]); }
    if (/"analyze_code"/.test(s)) sawAnalyze = true;
    if (/subflow|start_subworkflow/.test(s)) sawSubflow = true;
    const eff = rec.effect?.type || rec.effect?.payload?.type || '';
    if (eff === 'agent') { const sys = JSON.stringify(rec.effect?.payload || {}); if (/verifier|verify/i.test(sys)) sawVerifier = true; else sawBuilder = true; }
  }
}
note(`gates: execute_command=${sawExecuteCmd} analyze_code=${sawAnalyze} subflow=${sawSubflow} builder=${sawBuilder} verifier=${sawVerifier}`);
if (cmds.length) note(`commands seen: ${JSON.stringify([...new Set(cmds)].slice(0, 8))}`);

// Final output.
const root = tree.get(runId);
const out = root?.output;
note(`root output: ${JSON.stringify(out).slice(0, 600)}`);
// Workspace listing.
try {
  const { execSync } = await import('node:child_process');
  note(`workspace files: ${execSync(`ls -1 ${WS}`).toString().trim().replace(/\n/g, ', ')}`);
} catch {}
console.log('\nCODING-RUN DONE');
