/**
 * scripts/check_relative_urls.mjs (run by `npm run build` on dist/): the
 * editor never names a same-origin URL absolutely, so it works at / and
 * under the gateway at /apps/flow/.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { distFiles, findAbsoluteAppUrls, scan, sourceFiles } from '../scripts/check_relative_urls.mjs';

describe('check_relative_urls', () => {
  it('flags quoted app-absolute URLs and root references, not relative ones or escaped prose', () => {
    expect(findAbsoluteAppUrls(`fetch("/api/gateway/runs")`)).toHaveLength(1);
    expect(findAbsoluteAppUrls("x = '/assets/app.js'")).toHaveLength(1);
    expect(findAbsoluteAppUrls('t = `/api/gateway/${id}`')).toHaveLength(1);
    expect(findAbsoluteAppUrls('fetch("api/gateway/runs"); u = "./assets/app.js"')).toHaveLength(0);
    // Markdown bundled as a template literal quotes paths in prose with escaped backticks.
    expect(findAbsoluteAppUrls('doc = `the \\`/api/gateway/runs/start\\` path`')).toHaveLength(0);
    expect(findAbsoluteAppUrls('<script src="/assets/x.js"></script><link href="/x.css">', { html: true })).toHaveLength(2);
    expect(findAbsoluteAppUrls('a{background:url(/img.png)}', { html: true })).toHaveLength(1);
    expect(findAbsoluteAppUrls('<script src="./assets/x.js"></script><a href="//cdn.example/x">', { html: true })).toHaveLength(0);
  });

  it('the shipped source has no app-absolute URL', () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(scan(files)).toEqual([]);
  });

  it('a missing dist/ is a failure, never a pass', () => {
    const empty = mkdtempSync(join(tmpdir(), 'abstractflow-nodist-'));
    try {
      expect(() => distFiles(empty)).toThrow(/dist\/index\.html is missing/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
