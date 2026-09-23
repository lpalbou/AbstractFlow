/**
 * Live proof of the multi-agent coding workflow: start a run on the gateway,
 * auto-approve tool calls across the run tree, optionally answer the two
 * ask_user gates (wait mode) with scripted responses, poll to terminal, then
 * sweep evidence: scouts+planner+builder+doc ran, backlog item written, git
 * branch created, verify subflow produced a verdict, PR.md written, merge
 * state honest.
 *
 * Usage:
 *   DRIVE_TOKEN=... node scripts/multiagent_coding_run.mjs
 * Env:
 *   MW_REQUEST   task text (default: small factorial task)
 *   MW_WS        workspace (default ~/tmp/multiagent-run; wiped)
 *   MW_GATING    auto|wait (default auto). In wait mode gates are answered
 *                with MW_GATE1 (default 'approve') / MW_GATE2 ('approve').
 *   MW_VERSION   bundle version (default 0.0.0)
 *   MW_PROVIDER / MW_MODEL / MW_BUILD / MW_RUN / MW_MINUTES (default 45)
 */
import { mkdirSync, rmSync } from 'node:fs';

const GATEWAY = process.env.DRIVE_GATEWAY || 'http://127.0.0.1:8080';
const TOKEN = process.env.DRIVE_TOKEN || '';
const WS = process.env.MW_WS || `${process.env.HOME}/tmp/multiagent-run`;
const GATING = (process.env.MW_GATING || 'auto').toLowerCase();
const REQUEST = process.env.MW_REQUEST ||
  'Write a Python file solution.py with a function factorial(n) returning n! (iterative, n>=0) and a __main__ block printing factorial(5). It must run with: python3 solution.py';
const note = (s) => console.log(`[mw-run] ${s}`);
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function j(url, init) {
  const res = await fetch(url, init);
  const txt = await res.text();
  let body; try { body = JSON.parse(txt); } catch { body = txt; }
  if (!res.ok) throw new Error(`${init?.method || 'GET'} ${url} -> ${res.status}: ${txt.slice(0, 300)}`);
  return body;
}

let runId = process.env.MW_ATTACH || '';
if (runId) {
  note(`attaching to existing run: ${runId} (workspace assumed ${WS})`);
} else {
  if (!process.env.MW_KEEP_WS) { rmSync(WS, { recursive: true, force: true }); }
  mkdirSync(WS, { recursive: true });
  note(`workspace: ${WS} gating=${GATING}`);
  const start = await j(`${GATEWAY}/api/gateway/runs/start`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      bundle_id: 'multiagent-coding',
      bundle_version: process.env.MW_VERSION || '0.0.0',
      flow_id: 'multiagent-coding',
      input_data: {
        request: REQUEST,
        workspace_root: WS,
        workspace_access_mode: 'all_except_ignored',
        gating_mode: GATING,
        build_command: process.env.MW_BUILD ?? '',
        run_command: process.env.MW_RUN ?? '',
        ...(process.env.MW_PROVIDER ? { provider: process.env.MW_PROVIDER } : {}),
        ...(process.env.MW_MODEL ? { model: process.env.MW_MODEL } : {}),
      },
    }),
  });
  runId = start.run_id;
  note(`run started: ${runId}`);
}

async function listTree(root) {
  // CLIENT-SIDE parent filtering is mandatory: the runs listing can return
  // rows beyond the parent_run_id query (observed live 2026-07-23 - the
  // driver auto-approved waits on a CONCURRENT coding-agent run). Never
  // trust the query param alone when the action is an approval.
  const seen = new Map();
  const queue = [root];
  while (queue.length) {
    const rid = queue.shift();
    if (seen.has(rid)) continue;
    try {
      const r = await j(`${GATEWAY}/api/gateway/runs/${rid}`, { headers: H });
      seen.set(rid, r);
      const kids = await j(`${GATEWAY}/api/gateway/runs?parent_run_id=${rid}&limit=50`, { headers: H }).catch(() => ({}));
      for (const k of (kids.items || kids.runs || [])) {
        if (k.run_id && k.parent_run_id === rid) queue.push(k.run_id);
      }
    } catch { /* ignore */ }
  }
  return seen;
}

async function ledger(rid) {
  try { const r = await j(`${GATEWAY}/api/gateway/runs/${rid}/ledger`, { headers: H }); return r.items || r.records || r || []; }
  catch { return []; }
}

const deadline = Date.now() + Number(process.env.MW_MINUTES || 45) * 60_000;
const answered = new Set();
let finalStatus = '';
let gatePrompts = 0;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 5000));
  const tree = await listTree(runId);
  for (const [rid, r] of tree) {
    const w = r.waiting;
    if (r.status !== 'waiting' || !w || typeof w !== 'object') continue;
    // subworkflow waits auto-resolve when the child completes; never force-resume
    if (w.reason === 'subworkflow') continue;
    const wk = w.wait_key || '';
    // Dedup by (run, wait_key). Correct since 2026-08-01: the runtime mints
    // ONE durable key per approval instance
    // (`tool_approval:{run}:{node}:{effect_identity}`). Before that an agent
    // node reused `tool_calls:{run}:{node}` for every round, so this exact
    // line answered approval #1 and then parked the run forever on #2.
    // Keep the dedup: it is the idempotency measure, and it now doubles as a
    // regression detector.
    const key = `${rid}:${wk}`;
    if (answered.has(key)) continue;
    const isApproval = String(wk).startsWith('tool_approval') ||
      (w.details && w.details.mode === 'approval_required');
    if (isApproval && wk) {
      answered.add(key);
      try {
        await j(`${GATEWAY}/api/gateway/commands`, {
          method: 'POST', headers: H,
          body: JSON.stringify({ command_id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`, run_id: rid, type: 'resume', payload: { wait_key: wk, payload: { approved: true, auto_approved: true } } }),
        });
        note(`auto-approved tool ${wk} on ${rid.slice(0, 8)}`);
      } catch (e) { note(`approve failed: ${String(e).slice(0, 120)}`); }
      continue;
    }
    // ask_user gates (wait mode only; in auto mode reaching here = DEFECT)
    const promptText = String(w.prompt || w.details?.prompt || '');
    if (wk && (w.reason === 'user' || promptText)) {
      gatePrompts += 1;
      if (GATING === 'auto') {
        note(`DEFECT: ask_user wait surfaced in auto mode (${wk}): ${promptText.slice(0, 120)}`);
        continue; // do not answer; let it be visible
      }
      const isGate2 = /merge|review gate/i.test(promptText);
      const answer = isGate2 ? (process.env.MW_GATE2 || 'approve') : (process.env.MW_GATE1 || 'approve');
      answered.add(key);
      try {
        await j(`${GATEWAY}/api/gateway/commands`, {
          method: 'POST', headers: H,
          body: JSON.stringify({ command_id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`, run_id: rid, type: 'resume', payload: { wait_key: wk, payload: { response: answer } } }),
        });
        note(`answered gate (${isGate2 ? 'gate2' : 'gate1'}) with '${answer}' on ${rid.slice(0, 8)}`);
      } catch (e) { note(`gate answer failed: ${String(e).slice(0, 120)}`); }
    }
  }
  const root = tree.get(runId);
  const st = root?.status || '';
  if (st === 'completed' || st === 'failed' || st === 'cancelled') { finalStatus = st; break; }
}
note(`root terminal status: ${finalStatus || '#TIMEOUT'}`);
note(`gate prompts seen: ${gatePrompts}${GATING === 'auto' && gatePrompts ? '  <-- DEFECT in auto mode' : ''}`);

// Evidence sweep. NOTE: the gateway REWRITES workspace_root to its managed
// per-run workspace (live finding 2026-07-23), so the effective workspace is
// extracted from the composed git command in the ledger, never assumed.
const tree = await listTree(runId);
let agents = 0, sawSubflow = false, sawGitBranch = false, sawMerge = false, sawLint = false;
let effectiveWs = '';
for (const [rid] of tree) {
  const recs = await ledger(rid);
  for (const rec of recs) {
    const s = JSON.stringify(rec);
    if (/git checkout -b|GIT_CEILING/.test(s)) {
      sawGitBranch = true;
      const m = s.match(/cd '([^']+)'/);
      if (m && !effectiveWs) effectiveWs = m[1];
    }
    if (/merge --no-ff|MERGED_OK|MERGE_CONFLICT/.test(s)) sawMerge = true;
    if (/LINT_DONE|ruff check|prettier/.test(s)) sawLint = true;
    if (/start_subworkflow|"subflow"/.test(s)) sawSubflow = true;
    const eff = rec.effect?.type || '';
    if (eff === 'agent' || eff === 'start_subworkflow') agents += 1;
  }
}
note(`evidence: subruns=${agents} verify_subflow=${sawSubflow} git_branch=${sawGitBranch} lint=${sawLint} merge=${sawMerge}`);
note(`effective workspace: ${effectiveWs || '(not found in ledger)'}${effectiveWs && effectiveWs !== WS ? '  <-- gateway rewrote workspace_root' : ''}`);

const root = tree.get(runId);
note(`root output: ${JSON.stringify(root?.output).slice(0, 800)}`);
try {
  const { execSync } = await import('node:child_process');
  const ws = effectiveWs || WS;
  note(`workspace: ${execSync(`ls -1 ${JSON.stringify(ws)}`).toString().trim().replace(/\n/g, ', ')}`);
  note(`git graph: ${execSync(`cd ${JSON.stringify(ws)} && git log --graph --oneline --all 2>/dev/null | head -10`).toString().trim().replace(/\n/g, ' | ')}`);
} catch {}
console.log('\nMW-RUN DONE');
