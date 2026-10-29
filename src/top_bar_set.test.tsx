// The shared top-bar set (operator ruling 2026-10-29: "change the widget once,
// it changes everywhere"): the docs drawer button, the theme picker
// (Appearance), the About dialog and the account widget are the KIT's
// components, never local copies. Flow passes all four to the kit's
// AfTopBarActions: the docs toggle opens panel-chat's DocsAssistantDrawer
// (FlowDocsAssistant), Appearance opens the kit's AfAppearanceDialog, `about`
// renders the kit's AfAboutDialog, and identity="menu" with the app server's
// connection status renders its ONE account widget. Removing a piece from
// App.tsx (or re-implementing one locally) turns this red.
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AfTopBarActions, appIdentity } from '@abstractframework/ui-kit';
import { topBarConnectionState, type GatewayConnectionStatus } from './components/GatewayConnectionModal';

const SRC = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');

/** The props text of the first `<Tag ... />` in `src` (brace-aware: `/>` inside `{...}` does not end it). */
function jsxProps(src: string, tag: string): string {
  const start = src.indexOf(`<${tag}`);
  expect(start, `<${tag} in App.tsx`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth === 0 && c === '/' && src[i + 1] === '>') return src.slice(start, i);
  }
  throw new Error(`<${tag} is never closed`);
}

const SIGNED_IN: GatewayConnectionStatus = {
  ok: true,
  has_session: true,
  gateway_url: 'http://gw.local:8080',
  gateway: { ok: true, detail: { reason_code: 'x' }, principal: { user_id: 'alice', source: 'session' }, auth: { mode: 'users', user_auth_enabled: true } },
};

describe('the shared top-bar set', () => {
  const app = SRC('App.tsx');
  const bar = jsxProps(app, 'AfTopBarActions');

  it('passes the four kit pieces to AfTopBarActions', () => {
    expect(bar).toMatch(/\bdocs=\{\{ open: docs_open,/);
    expect(bar).toMatch(/\bappearance=\{\{ onOpen: \(\) => set_show_appearance\(true\) \}\}/);
    expect(bar).toContain('about={about_action}');
    expect(bar).toContain('identity="menu"');
    expect(bar).toMatch(/status: topBarConnectionState\(connection_status\)/);
  });

  it('opens the kit dialogs and the panel-chat docs drawer, never local copies', () => {
    expect(jsxProps(app, 'AfAppearanceDialog')).toMatch(/open=\{show_appearance\}/);
    expect(SRC('components/FlowDocsAssistant.tsx')).toMatch(/import \{ DocsAssistantDrawer[^}]*\} from '@abstractframework\/panel-chat'/);
    expect(jsxProps(app, 'FlowDocsAssistant')).toMatch(/open=\{docs_open\}/);
    for (const local of [/function \w*About\w*Dialog/, /function \w*Appearance\w*Dialog/, /Signed in as/, /af-topbar__identity/]) expect(app).not.toMatch(local);
  });

  it('hands the kit the session it reads the account from', () => {
    const state = topBarConnectionState(SIGNED_IN);
    expect(state).toEqual({
      ok: true,
      has_session: true,
      gateway_url: 'http://gw.local:8080',
      gateway: { ok: true, principal: { user_id: 'alice', source: 'session' }, auth: { mode: 'users', user_auth_enabled: true } },
    });
    expect(topBarConnectionState(null)).toBeNull();
    expect(topBarConnectionState({ ok: false, has_session: false, gateway_url: '' })).toEqual({ ok: false, has_session: false, gateway_url: '' });
  });

  it('the installed kit renders the set with the one account widget (ui-kit ^0.9.6)', () => {
    const noop = () => {};
    const html = renderToStaticMarkup(
      createElement(AfTopBarActions, {
        docs: { open: false, onToggle: noop },
        appearance: { onOpen: noop },
        about: { identity: appIdentity('abstractflow', '0.0.0') },
        identity: 'menu',
        connection: { phase: 'connected', onConnect: noop, onDisconnect: noop, status: topBarConnectionState(SIGNED_IN) },
      })
    );
    const at = ['af-topbar__btn--docs', 'af-topbar__btn--appearance', 'af-topbar__btn--about', 'data-af-identity="menu"'].map((m) => html.indexOf(m));
    expect(at.every((v, i) => v >= 0 && (i === 0 || v > at[i - 1]))).toBe(true);
    expect(html).toContain('<span class="af-topbar__identity-label">alice</span>');
    expect(html).not.toContain('af-topbar__pill');
  });
});
