// The gateway console's Triggers page links the flow that handles a trigger
// to Flow: `?flow=<visualflow id>` opens that library flow (docs/web-editor.md).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FLOW_LINK_MISSING_ID, flowLinkNotFound, parseFlowLink, withoutFlowParam } from './flowDeepLink';

describe('parseFlowLink', () => {
  it('reads the library flow id', () => {
    expect(parseFlowLink('?flow=judge-what-arrived')).toEqual({ flowId: 'judge-what-arrived' });
    expect(parseFlowLink('?flow=a%20b&x=1')).toEqual({ flowId: 'a b' });
  });
  it('is null without the parameter, and never reads a bundle link', () => {
    expect(parseFlowLink('')).toBeNull();
    expect(parseFlowLink('?trigger=conn_1')).toBeNull();
    expect(parseFlowLink('?bundle=digest&version=1.0.0&flow=digest')).toBeNull();
  });
  it('says what an empty link needs', () => {
    expect(parseFlowLink('?flow=')).toEqual({ error: FLOW_LINK_MISSING_ID });
    expect(parseFlowLink('?flow=%20')).toEqual({ error: FLOW_LINK_MISSING_ID });
  });
});

describe('withoutFlowParam', () => {
  it('drops only flow, keeps the rest and the hash', () => {
    expect(withoutFlowParam('http://127.0.0.1:8080/apps/flow/?flow=abc')).toBe('/apps/flow/');
    expect(withoutFlowParam('http://127.0.0.1:3005/?flow=abc&x=1#k')).toBe('/?x=1#k');
  });
});

describe('the toolbar opens a ?flow= link through the library load path', () => {
  const src = readFileSync(new URL('../components/Toolbar.tsx', import.meta.url), 'utf8');
  it('waits for the gateway, strips the parameter, loads through doLoadFlow with a not-found toast', () => {
    const at = src.indexOf('parseFlowLink(window.location.search)');
    expect(at).toBeGreaterThan(0);
    const block = src.slice(src.lastIndexOf('useEffect(', at), src.indexOf('}, [', at));
    expect(block).toContain('gatewayCapabilitiesQuery.isLoading');
    expect(block).toContain('withoutFlowParam(window.location.href)');
    expect(block).toContain('void doLoadFlow(link.flowId, { notFound: flowLinkNotFound(link.flowId) })');
    const load = src.slice(src.indexOf('const doLoadFlow = useCallback('), src.indexOf('// `?bundle=<id>'));
    expect(load).toContain('error instanceof GatewayHttpError && error.status === 404 && opts?.notFound');
  });
  it('says the not-found sentence', () => {
    expect(flowLinkNotFound('abc')).toBe('The flow abc is not in your Flow library any more.');
  });
});
