/**
 * Headless-Chrome screenshot of the authoring assistant harness
 * (assistant_check.html), dark + light themes.
 *
 * Usage:
 *   npx vite --port 3015 --strictPort   (in the repo root)
 *   node scripts/assistant_check_shot.mjs
 */

import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('No Chrome/Chromium binary found; set CHROME_PATH.');
  process.exit(2);
}

const base = process.env.ASSISTANT_CHECK_URL ?? 'http://localhost:3015/scripts/assistant_check.html';
const targets = [
  { theme: 'dark', shot: '/tmp/abstractflow_assistant_check_dark.png' },
  { theme: 'one-light', shot: '/tmp/abstractflow_assistant_check_light.png' },
];

for (const { theme, shot } of targets) {
  await new Promise((resolve, reject) => {
    const child = spawn(chrome, [
      '--headless=new',
      '--no-sandbox',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      '--window-size=880,760',
      `--screenshot=${shot}`,
      '--virtual-time-budget=8000',
      `${base}?theme=${theme}`,
    ]);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`chrome exited ${code}`))));
  });
  console.log(`screenshot: ${shot}`);
}
