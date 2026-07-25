/**
 * Generic single-arm driver for the 3-way coding comparison. Starts one run,
 * auto-approves every tool + subworkflow wait across the (parent-filtered)
 * run tree, polls to terminal, then reports evidence: effective workspace,
 * files written, subrun count, token/tool usage, final output.
 *
 * Env:
 *   ARM        label (multiagent|basic|coder) - drives which bundle/input
 *   DRIVE_TOKEN  gateway bearer
 *   ARM_PROMPT   the task text (same for all arms)
 *   ARM_PROVIDER / ARM_MODEL
 *   ARM_MINUTES  wall budget (default 40)
 *   ARM_TAG      workspace tag suffix
 */
import { mkdirSync, rmSync } from 'node:fs';

const GATEWAY = process.env.DRIVE_GATEWAY || 'http://127.0.0.1:8080';
const TOKEN = process.env.DRIVE_TOKEN || '';
const ARM = (process.env.ARM || 'multiagent').toLowerCase();
const PROMPT = process.env.ARM_PROMPT || 'Write hello world in hello.txt';
const PROVIDER = process.env.ARM_PROVIDER || 'endpoint:ovh-provider';
const MODEL = process.env.ARM_MODEL || 'gpt-oss-120b';
const MINUTES = Number(process.env.ARM_MINUTES || 40);
const TAG = process.env.ARM_TAG || ARM;
const WS = `/Users/albou/tmp/rtype-cmp/${TAG}`;
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const note = (s) => console.log(`[${ARM}] ${s}`);

async function j(url, init) {
  const res = await fetch(url, init);
  const txt = await res.text();
  let body; try { body = JSON.parse(txt); } catch { body = txt; }
  if (!res.ok) throw new Error(`${init?.method || 'GET'} ${url} -> ${res.status}: ${txt.slice(0, 300)}`);
  return body;
}

// Per-arm start request. All arms: same prompt, provider, model, auto tool
// approval. multiagent-coding is coding.v1 (request/workspace_root/auto gate);
// basic-agent + coder are agent.v1 (prompt).
function startBody() {
  const rt = { tool_policy: { auto_approve_tools: ['execute_command'] } };
  if (ARM === 'multiagent') {
    return {
      bundle_id: 'multiagent-coding', bundle_version: '0.0.1', flow_id: 'multiagent-coding',
      input_data: {
        request: PROMPT, workspace_root: WS, workspace_access_mode: 'all_except_ignored',
        gating_mode: 'auto', build_command: '', run_command: '',
        browser_probe_available: false, provider: PROVIDER, model: MODEL, _runtime: rt,
      },
    };
  }
  if (ARM === 'coder') {
    return {
      bundle_id: 'coding-agent', bundle_version: '0.2.4', flow_id: 'coder',
      input_data: {
        prompt: PROMPT, workspace_root: WS, workspace_access_mode: 'all_except_ignored',
        provider: PROVIDER, model: MODEL, _runtime: rt,
      },
    };
  }
  // basic-agent
  return {
    bundle_id: 'basic-agent', bundle_version: '0.0.2', flow_id: '81795ea9',
    input_data: {
      prompt: PROMPT, workspace_root: WS, workspace_access_mode: 'all_except_ignored',
      provider: PROVIDER, model: MODEL, max_iterations: 60, _runtime: rt,
    },
  };
}

if (!process.env.ARM_ATTACH) {
  rmSync(WS, { recursive: true, force: true });
  mkdirSync(WS, { recursive: true });
}
let runId = process.env.ARM_ATTACH || '';
if (!runId) {
  const start = await j(`${GATEWAY}/api/gateway/runs/start`, { method: 'POST', headers: H, body: JSON.stringify(startBody()) });
  runId = start.run_id;
  note(`run started: ${runId} (ws ${WS})`);
} else {
  note(`attaching: ${runId}`);
}

async function listTree(root) {
  const seen = new Map();
  const queue = [root];
  while (queue.length) {
    const rid = queue.shift();
    if (seen.has(rid)) continue;
    try {
      const r = await j(`${GATEWAY}/api/gateway/runs/${rid}`, { headers: H });
      seen.set(rid, r);
      const kids = await j(`${GATEWAY}/api/gateway/runs?parent_run_id=${rid}&limit=60`, { headers: H }).catch(() => ({}));
      for (const k of (kids.items || kids.runs || [])) {
        if (k.run_id && k.parent_run_id === rid) queue.push(k.run_id); // parent-filter (server over-returns)
      }
    } catch { /* ignore */ }
  }
  return seen;
}
async function ledger(rid) {
  try { const r = await j(`${GATEWAY}/api/gateway/runs/${rid}/ledger`, { headers: H }); return r.items || r.records || r || []; }
  catch { return []; }
}

const deadline = Date.now() + MINUTES * 60_000;
const answered = new Set();
let finalStatus = '';
let lastRootUpdate = '';
let stalls = 0;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 5000));
  const tree = await listTree(runId);
  for (const [rid, r] of tree) {
    const w = r.waiting;
    if (r.status !== 'waiting' || !w || typeof w !== 'object') continue;
    // NEVER resume a subworkflow wait: the parent auto-resolves when the child
    // completes. Force-resuming it completes the parent past the subflow with
    // empty output and fakes a "verify child died" in the build loop. Approve
    // only the CHILD's tool waits; approvals propagate up the tree.
    if (w.reason === 'subworkflow') continue;
    const wk = w.wait_key || '';
    const key = `${rid}:${wk}`;
    if (answered.has(key) || !wk) continue;
    const isApproval = String(wk).startsWith('tool_approval') || String(wk).includes(':act') ||
      (w.details && w.details.mode === 'approval_required');
    if (isApproval) {
      answered.add(key);
      try {
        await j(`${GATEWAY}/api/gateway/commands`, { method: 'POST', headers: H,
          body: JSON.stringify({ command_id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`, run_id: rid, type: 'resume', payload: { wait_key: wk, payload: { approved: true, auto_approved: true } } }) });
      } catch { /* ignore */ }
    }
  }
  const root = tree.get(runId);
  const st = root?.status || '';
  if (root?.updated_at === lastRootUpdate) stalls += 1; else stalls = 0;
  lastRootUpdate = root?.updated_at || '';
  if (st === 'completed' || st === 'failed' || st === 'cancelled') { finalStatus = st; break; }
}
note(`terminal: ${finalStatus || '#TIMEOUT'}`);

// evidence
const tree = await listTree(runId);
let subruns = 0, inTok = 0, outTok = 0, tools = 0, effWs = '';
for (const [rid] of tree) {
  const recs = await ledger(rid);
  for (const rec of recs) {
    const eff = rec.effect?.type || '';
    if (eff === 'agent' || eff === 'start_subworkflow') subruns += 1;
    if (eff === 'tool_calls') tools += 1;
    const u = rec.result?.usage || rec.usage || {};
    inTok += Number(u.input_tokens || u.prompt_tokens || 0);
    outTok += Number(u.output_tokens || u.completion_tokens || 0);
    if (!effWs) { const m = JSON.stringify(rec).match(/workspaces\/([a-f0-9]{32})/); if (m) effWs = `/Users/albou/tmp/abstractframework/runtime/workspaces/${m[1]}`; }
  }
}
note(`evidence: subruns=${subruns} tool_batches=${tools} in_tok=${inTok} out_tok=${outTok}`);
note(`effective workspace: ${effWs || WS}`);
const root = tree.get(runId);
note(`output: ${JSON.stringify(root?.output).slice(0, 500)}`);
try {
  const { execSync } = await import('node:child_process');
  const ws = effWs || WS;
  note(`files: ${execSync(`cd ${JSON.stringify(ws)} && find . -type f -not -path './.git/*' 2>/dev/null | head -40`).toString().trim().replace(/\n/g, ', ')}`);
  note(`bytes: ${execSync(`cd ${JSON.stringify(ws)} && find . -type f -not -path './.git/*' -exec cat {} + 2>/dev/null | wc -c`).toString().trim()} total chars`);
} catch (e) { note(`fs read failed: ${String(e).slice(0,120)}`); }
console.log(`\n${ARM} ARM DONE`);
