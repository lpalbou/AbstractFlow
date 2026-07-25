/**
 * Prove multiagent-coder (agent.v1 wrapper) is executable BY AN AGENT CLIENT:
 * drive it with a {prompt} payload exactly as basic-agent/coder are driven,
 * auto-approve tools across the (parent-filtered) tree, and confirm it returns
 * the agent.v1 contract {response, success, meta}. Small factorial task (no
 * browser) so it completes without the R-Type verify-death confound.
 */
const GATEWAY = 'http://127.0.0.1:8080';
const TOKEN = process.env.DRIVE_TOKEN || '';
const WS = process.env.WRAP_WS || '/Users/albou/tmp/mac-wrapper-smoke';
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const note = (s) => console.log(`[wrap] ${s}`);
async function j(u, i) { const r = await fetch(u, i); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } if (!r.ok) throw new Error(`${i?.method||'GET'} ${u} -> ${r.status}: ${t.slice(0,200)}`); return b; }

const start = await j(`${GATEWAY}/api/gateway/runs/start`, { method: 'POST', headers: H, body: JSON.stringify({
  bundle_id: 'multiagent-coding', bundle_version: '0.0.2', flow_id: 'multiagent-coder',
  input_data: {
    prompt: 'Write solution.py with factorial(n) (iterative, n>=0) and a __main__ printing factorial(5). Run: python3 solution.py',
    workspace_root: WS, workspace_access_mode: 'all_except_ignored',
    provider: 'endpoint:ovh-provider', model: 'gpt-oss-120b',
    _runtime: { tool_policy: { auto_approve_tools: ['execute_command'] } },
  },
})});
const runId = start.run_id;
note(`agent.v1 run started (flow_id=multiagent-coder): ${runId}`);

async function tree(root) { const seen = new Map(); const q = [root]; while (q.length) { const rid = q.shift(); if (seen.has(rid)) continue; try { const r = await j(`${GATEWAY}/api/gateway/runs/${rid}`, { headers: H }); seen.set(rid, r); const k = await j(`${GATEWAY}/api/gateway/runs?parent_run_id=${rid}&limit=60`, { headers: H }).catch(() => ({})); for (const c of (k.items||[])) if (c.run_id && c.parent_run_id === rid) q.push(c.run_id); } catch {} } return seen; }

const deadline = Date.now() + 20 * 60000; const answered = new Set(); let fin = '';
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 5000));
  const t = await tree(runId);
  // NEVER resume a `subworkflow` wait: the parent auto-resolves when the child
  // completes. Force-resuming it completes the parent past the subflow with
  // empty output (and, in the build loop, fakes a "verify child died"). Only
  // approve the CHILD's tool_approval / ask_user waits; approvals propagate up.
  for (const [rid, r] of t) { const w = r.waiting; if (r.status !== 'waiting' || !w) continue; if (w.reason === 'subworkflow') continue; const wk = w.wait_key||''; const key = `${rid}:${wk}`; if (answered.has(key)||!wk) continue; const appr = String(wk).startsWith('tool_approval')||String(wk).includes(':act')||(w.details&&w.details.mode==='approval_required'); if (appr) { answered.add(key); try { await j(`${GATEWAY}/api/gateway/commands`, { method:'POST', headers:H, body: JSON.stringify({ command_id:`c-${Date.now()}-${Math.random().toString(36).slice(2)}`, run_id: rid, type:'resume', payload:{ wait_key: wk, payload: {approved:true, auto_approved:true} } }) }); } catch {} } }
  const root = t.get(runId); const st = root?.status||''; if (st==='completed'||st==='failed'||st==='cancelled') { fin = st; break; }
}
const t = await tree(runId); const root = t.get(runId); const out = root?.output || {};
note(`terminal: ${fin} | root flow = multiagent-coder`);
note(`agent.v1 contract check: response present=${typeof out.response==='string'} | success=${out.success} | meta=${JSON.stringify(out.meta)}`);
note(`response (first 400): ${String(out.response||'').slice(0,400)}`);
console.log('\nWRAP SMOKE DONE');
