/**
 * Cheap live proof for the no-tool workflows (structured-extract, map-reduce):
 * start a run against the gateway, poll to terminal (no approvals needed —
 * these use only LLM calls), and print the output. Proves the loop machinery
 * runs end to end against a real model.
 */
const GATEWAY = 'http://127.0.0.1:8080';
const TOKEN = process.env.DRIVE_TOKEN || '';
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const note = (s) => console.log(`[probe] ${s}`);

async function j(url, init) {
  const res = await fetch(url, init);
  const t = await res.text();
  let b; try { b = JSON.parse(t); } catch { b = t; }
  if (!res.ok) throw new Error(`${init?.method || 'GET'} ${url} -> ${res.status}: ${t.slice(0, 300)}`);
  return b;
}

const which = process.argv[2] || 'structured-extract';
const inputs = {
  'structured-extract': {
    bundle_id: 'structured-extract', flow_id: 'structured-extract',
    input_data: {
      source_text: 'Ada Lovelace (born 10 December 1815 in London) was an English mathematician, widely regarded as the first computer programmer for her work on Babbage\'s Analytical Engine.',
      fields_spec: { type: 'object', additionalProperties: false, required: ['name', 'birth_year', 'nationality'], properties: { name: { type: 'string' }, birth_year: { type: 'integer' }, nationality: { type: 'string' }, known_for: { type: 'string' } } },
      max_attempts: 3,
    },
  },
  'map-reduce': {
    bundle_id: 'map-reduce', flow_id: 'map-reduce',
    input_data: {
      items: ['The mitochondrion is the powerhouse of the cell.', 'Photosynthesis converts light into chemical energy.', 'DNA carries genetic instructions.'],
      item_instruction: 'In one sentence, restate this biology fact for a 10-year-old.',
      reduce_instruction: 'Combine the kid-friendly restatements into a short paragraph.',
    },
  },
}[which];

if (!inputs) { note(`unknown workflow ${which}`); process.exit(1); }

const start = await j(`${GATEWAY}/api/gateway/runs/start`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ bundle_id: inputs.bundle_id, bundle_version: '0.1.0', flow_id: inputs.flow_id, input_data: inputs.input_data }),
});
const runId = start.run_id;
note(`${which} run: ${runId}`);

const deadline = Date.now() + 8 * 60_000;
let st = '';
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 4000));
  const r = await j(`${GATEWAY}/api/gateway/runs/${runId}`, { headers: H }).catch(() => ({}));
  st = r.status || '';
  if (st === 'completed' || st === 'failed' || st === 'cancelled') {
    note(`terminal: ${st}`);
    note(`output: ${JSON.stringify(r.output).slice(0, 900)}`);
    break;
  }
  if (r.status === 'waiting') { note(`unexpected wait: ${JSON.stringify(r.waiting).slice(0, 200)}`); }
}
if (!(st === 'completed' || st === 'failed' || st === 'cancelled')) note('#TIMEOUT');
console.log('\nPROBE DONE');
