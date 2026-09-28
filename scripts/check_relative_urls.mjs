#!/usr/bin/env node
/**
 * Fails when the editor names a same-origin URL absolutely.
 *
 * AbstractFlow is served at `/` and under the gateway at `/apps/flow/`: the
 * page's `<base href>` makes RELATIVE URLs follow the base path, and an
 * app-absolute `"/api/..."` or `"/assets/..."` escapes it (the request would
 * reach the gateway's own `/api`, or nothing). Scans the shipped source
 * (src/, tests excluded) and the built editor (dist/index.html, dist/assets).
 * A missing dist/ is a failure, never a pass: run it after `vite build`
 * (`npm run build` does).
 *
 *   node scripts/check_relative_urls.mjs [--src-only]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A quoted app-absolute URL: "/api/…", '/assets/…', `/api/…`. An ESCAPED
 * quote is text inside a string (the bundled docs quote \`/api/…\` in
 * prose), not the start of a URL literal.
 */
const QUOTED_ABSOLUTE = /(?<!\\)["'`]\/(?:api|assets)\//g;
/** An HTML/CSS reference to a root path: src="/x", href="/x", url(/x). */
const ROOT_REFERENCE = /\b(?:src|href)=["']\/(?!\/)|url\(\s*["']?\/(?!\/)/g;

/** Every offending match in `text`, as {index, line, snippet}. */
export function findAbsoluteAppUrls(text, { html = false } = {}) {
  const out = [];
  const body = String(text);
  const slashes = new Set(); // one finding per URL, whichever pattern saw it
  for (const re of html ? [QUOTED_ABSOLUTE, ROOT_REFERENCE] : [QUOTED_ABSOLUTE]) {
    re.lastIndex = 0;
    for (let m = re.exec(body); m; m = re.exec(body)) {
      const slash = m.index + m[0].lastIndexOf('/', re === QUOTED_ABSOLUTE ? 2 : m[0].length);
      if (slashes.has(slash)) continue;
      slashes.add(slash);
      const line = body.slice(0, m.index).split('\n').length;
      out.push({ index: m.index, line, snippet: body.slice(Math.max(0, m.index - 30), m.index + 50).replace(/\s+/g, ' ') });
    }
  }
  return out;
}

function walk(dir, keep) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files.push(...walk(path, keep));
    else if (keep(path)) files.push(path);
  }
  return files;
}

/** The shipped source files: src/**.{ts,tsx}, tests and fixtures excluded. */
export function sourceFiles(root = ROOT) {
  return walk(join(root, 'src'), (p) => /\.(ts|tsx)$/.test(p) && !/\.test\.(ts|tsx)$/.test(p) && !/\.fixtures\.ts$/.test(p));
}

/** The built files: dist/index.html and dist/assets/*.{js,css}. Throws when dist/ is missing. */
export function distFiles(root = ROOT) {
  const index = join(root, 'dist', 'index.html');
  if (!existsSync(index)) throw new Error(`${relative(root, index)} is missing: build first (npm run build)`);
  return [index, ...walk(join(root, 'dist', 'assets'), (p) => /\.(js|css)$/.test(p))];
}

export function scan(files, root = ROOT) {
  const problems = [];
  for (const file of files) {
    const html = /\.(html|css)$/.test(file);
    for (const hit of findAbsoluteAppUrls(readFileSync(file, 'utf8'), { html })) {
      problems.push(`${relative(root, file)}:${hit.line}: ${hit.snippet}`);
    }
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const srcOnly = process.argv.includes('--src-only');
  let files;
  try {
    files = [...sourceFiles(), ...(srcOnly ? [] : distFiles())];
  } catch (err) {
    process.stderr.write(`check_relative_urls: ${err.message}\n`);
    process.exit(1);
  }
  const problems = scan(files);
  if (problems.length) {
    process.stderr.write(
      `check_relative_urls: ${problems.length} app-absolute URL(s); use a relative URL (ui-kit gateway_paths, gatewayRequestPath in src/utils/gatewayClient.ts) so the editor works under /apps/flow/:\n` +
        problems.map((p) => `  ${p}`).join('\n') +
        '\n'
    );
    process.exit(1);
  }
  process.stdout.write(`check_relative_urls: ${files.length} files, no app-absolute URL\n`);
}
