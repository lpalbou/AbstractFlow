/**
 * Under the gateway every app shares ONE origin (/apps/<id>/ on the
 * gateway's host), so localStorage/sessionStorage are shared too: every key
 * AbstractFlow reads or writes must be its own (`abstractflow_…`). Scans the
 * shipped source for storage calls and resolves each key argument; a key it
 * cannot resolve fails the test (write it so it can be checked).
 */
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { sourceFiles } from '../scripts/check_relative_urls.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = 'abstractflow_';
const CALL = /\b(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*([^,)]+)/g;

function constants(text) {
  const out = new Map();
  for (const m of text.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`]*)\2\s*;/g)) out.set(m[1], m[3]);
  for (const m of text.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*scopedAssistantStorageKey\(\s*([A-Za-z_$][\w$]*)/g)) out.set(m[1], { via: m[2] });
  return out;
}

/** The key literal an argument resolves to, or null. */
function resolveKey(arg, consts, text) {
  const a = arg.trim();
  const literal = /^(['"`])([^'"`]*)\1$/.exec(a);
  if (literal) return literal[2];
  const scoped = /^scopedAssistantStorageKey\(\s*([A-Za-z_$][\w$]*)/.exec(a);
  if (scoped) return resolveKey(scoped[1], consts, text);
  if (/^[A-Za-z_$][\w$]*$/.test(a)) {
    const v = consts.get(a);
    if (typeof v === 'string') return v;
    if (v && v.via) return resolveKey(v.via, consts, text);
    // The one-time cleanup loop: keys enumerated from storage, filtered on our prefix.
    if (a === 'key' && text.includes(`key.startsWith('${PREFIX}`)) return PREFIX;
  }
  return null;
}

describe('storage keys are namespaced (shared origin under the gateway)', () => {
  it('every localStorage/sessionStorage key in src starts with abstractflow_', () => {
    const problems = [];
    let calls = 0;
    for (const file of sourceFiles(ROOT)) {
      const text = readFileSync(file, 'utf8');
      const consts = constants(text);
      for (const m of text.matchAll(CALL)) {
        calls += 1;
        const key = resolveKey(m[1], consts, text);
        if (key === null) problems.push(`${relative(ROOT, file)}: cannot resolve the key ${m[1].trim()}`);
        else if (!key.startsWith(PREFIX)) problems.push(`${relative(ROOT, file)}: key ${JSON.stringify(key)} is not ${PREFIX}…`);
      }
    }
    expect(problems).toEqual([]);
    // The scan found the editor's storage use (a scan that sees nothing proves nothing).
    expect(calls).toBeGreaterThan(20);
  });

  it('the check itself goes red on a foreign key', () => {
    const text = "const K = 'theme_v1';\nlocalStorage.getItem(K);";
    expect(resolveKey('K', constants(text), text)).toBe('theme_v1');
    expect(resolveKey('mystery()', constants(text), text)).toBeNull();
  });
});
