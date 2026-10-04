// Round 8 (R8.3): Flow's Docs assistant is the kit's shared DocsAssistantDrawer
// on Flow's own llms.txt (read by the gateway from this app's build) through the
// docs-qa workflow; separate from the Authoring assistant.
import http from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocsAssistantPanel, makeDocsQaAsk } from '@abstractframework/panel-chat';
import { FLOW_DOCS_SOURCE, FlowDocsAssistant } from './FlowDocsAssistant';
import { docsGatewayFetch } from '../utils/gatewayClient';
// @ts-expect-error bin/server.js is plain ESM JavaScript without types
import { createFlowServer } from '../../bin/server.js';

const appSource = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');
const mainSource = readFileSync(resolve(__dirname, '../main.tsx'), 'utf8');
const enc = new TextEncoder();

function fakeGateway() {
  const calls: { url: string; method: string; csrf: string | null; body?: unknown }[] = [];
  let polls = 0;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const delta = (seq: number, text: string) => `event: llm.delta\ndata: ${JSON.stringify({ kind: 'llm.delta', run_id: 'r1', call_id: 'c1', seq, text, channel: 'content', snapshot: false })}\n\n`;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers || {});
    calls.push({ url, method: String(init.method || 'GET'), csrf: headers.get('X-AbstractFlow-CSRF'), body: init.body });
    if (url === 'api/gateway/docs/corpus?app=flow') return json({ app: 'AbstractFlow', text: '# AbstractFlow\n\n## Run\nPress Run in the toolbar.' });
    if (url === 'api/gateway/attachments/upload') return json({ attachment: { $artifact: 'art-1', filename: 'graph.png' } });
    if (url === 'api/gateway/runs/start') return json({ run_id: 'r1' });
    if (url === 'api/gateway/runs/r1/ledger/stream?after=0')
      return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(delta(0, 'Press '))); c.enqueue(enc.encode(delta(1, '**Run**.'))); c.close(); } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    if (url === 'api/gateway/runs/r1') return json({ status: polls++ ? 'completed' : 'running', output: { response: 'Press **Run** in the toolbar.' } });
    return new Response(JSON.stringify({ detail: `unexpected ${url}` }), { status: 404 });
  });
  vi.stubGlobal('document', { cookie: 'abstractflow_gateway_csrf=flow%2Dcsrf' });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('Flow Docs assistant (kit DocsAssistantDrawer)', () => {
  it('asks docs-qa with Flow’s llms.txt, sends attachments, streams, CSRF on writes', async () => {
    const calls = fakeGateway();
    const ask = makeDocsQaAsk({ fetchGateway: docsGatewayFetch, source: FLOW_DOCS_SOURCE, pollMs: 1 });
    const live: string[] = [];
    const file = new File([new Uint8Array([1, 2, 3])], 'graph.png', { type: 'image/png' });
    const answer = await ask('How do I run a flow?', { signal: new AbortController().signal, sessionId: 'flow-docs-assistant:s', files: [file], onText: (t) => live.push(t) });
    expect(answer).toBe('Press **Run** in the toolbar.');
    expect(live).toEqual(['Press ', 'Press **Run**.']);
    const start = calls.find((c) => c.url === 'api/gateway/runs/start')!;
    const body = JSON.parse(String(start.body));
    expect(body).toMatchObject({ bundle_id: 'docs-qa', session_id: 'flow-docs-assistant:s' });
    expect(body.input_data).toMatchObject({ app: 'AbstractFlow', prompt: 'How do I run a flow?', context: { attachments: [{ $artifact: 'art-1' }] } });
    expect(body.input_data.docs).toContain('Press Run in the toolbar.');
    expect(start.csrf).toBe('flow-csrf');
    expect(calls.find((c) => c.url === 'api/gateway/attachments/upload')!.csrf).toBe('flow-csrf');
    expect(calls.find((c) => c.url.startsWith('api/gateway/docs/corpus'))!.csrf).toBeNull();

    const html = renderToStaticMarkup(createElement(DocsAssistantPanel, {
      source: FLOW_DOCS_SOURCE, draft: '', onDraftChange: () => {}, onSend: () => {},
      messages: [{ role: 'user', content: 'How do I run a flow?' }, { role: 'assistant', title: 'AbstractFlow', content: answer }],
    }));
    expect(html).toContain('pc-chat-item--user');
    expect(html).toContain('pc-chat-item--assistant');
    expect(html).toContain('<strong>Run</strong>');
    expect(html).toContain('Grounded on AbstractFlow’s documentation (llms.txt) · docs-qa');
  });

  it('renders the shared drawer: icon-only New conversation, close, attach, keep-alive', () => {
    const html = renderToStaticMarkup(createElement(FlowDocsAssistant, { open: false, onClose: () => {}, connected: true, headerRef: createRef<HTMLElement>() }));
    expect(html).toContain('flow-docs-assistant');
    expect(html).toContain('display:none');
    expect(html).toMatch(/aria-label="New conversation"[^>]*><svg/);
    expect(html).not.toMatch(/>New conversation</);
    expect(html).toContain('aria-label="Close panel"');
    expect(html).toContain('aria-label="Attach files"');
  });

  it('is opened from the top bar docs slot, beside (not instead of) the Authoring assistant', () => {
    expect(appSource).toMatch(/docs=\{\{ open: docs_open,/);
    expect(appSource).toContain("label: 'Authoring assistant'");
    expect(appSource).toContain('<FlowDocsAssistant');
    expect(mainSource).toContain("import '@abstractframework/panel-chat/panel_chat.css';");
  });

  it('the app serves its llms.txt as text/plain (what the gateway reads)', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'flow-dist-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>AbstractFlow</title>');
    writeFileSync(join(dist, 'llms.txt'), '# AbstractFlow\n');
    const server = createFlowServer({ distDir: dist, gatewayUrl: 'http://127.0.0.1:9' });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    try {
      const port = (server.address() as { port: number }).port;
      const res = await new Promise<{ status: number; type: string; body: string }>((ok, fail) => {
        http.get(`http://127.0.0.1:${port}/llms.txt`, (r) => {
          let body = '';
          r.on('data', (d) => (body += d));
          r.on('end', () => ok({ status: r.statusCode || 0, type: String(r.headers['content-type'] || ''), body }));
        }).on('error', fail);
      });
      expect(res.status).toBe(200);
      expect(res.type).toMatch(/^text\/plain/);
      expect(res.body).toBe('# AbstractFlow\n');
    } finally {
      server.close();
    }
  });
});
