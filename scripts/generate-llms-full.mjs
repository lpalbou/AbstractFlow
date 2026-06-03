#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const files = [
  'README.md',
  'docs/README.md',
  'docs/getting-started.md',
  'docs/web-editor.md',
  'docs/architecture.md',
  'docs/api.md',
  'docs/visualflow.md',
  'docs/cli.md',
  'docs/faq.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
];

const parts = [
  '# AbstractFlow Full LLM Context',
  '',
  'This file is generated from the root documentation set with `npm run docs:llms`.',
  '',
];

for (const relativePath of files) {
  const absolutePath = join(root, relativePath);
  if (!existsSync(absolutePath)) continue;
  parts.push(`## ${relativePath}`, '');
  parts.push(readFileSync(absolutePath, 'utf8').trim(), '');
}

writeFileSync(join(root, 'llms-full.txt'), `${parts.join('\n').trimEnd()}\n`, 'utf8');
