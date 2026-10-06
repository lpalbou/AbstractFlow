#!/usr/bin/env node
/**
 * Lockfile guard for the AbstractFramework shared UI packages (`npm run check:lock`, also a CI step).
 *
 * Fails (exit 1) when:
 *   1. package-lock.json lags package.json at all: the lock's root entry (packages[""]) records a
 *      different name, version, or dependency spec (dependencies, devDependencies,
 *      optionalDependencies, peerDependencies) than package.json — someone edited package.json
 *      without running `npm install`;
 *   2. an @abstractframework/* dependency of package.json is missing from the lock, resolves below
 *      package.json's floor (the version in `^x.y.z` / `~x.y.z` / `>=x.y.z` / `x.y.z`), or resolves
 *      to a different major.minor than that floor;
 *   3. an @abstractframework/* package is resolved from anywhere but the npm registry (a `file:`
 *      tarball or a link: a same-version repack leaves node_modules stale), or a nested copy of it
 *      differs from the top-level one (two copies of the kit in one app).
 *
 * `--latest` (release time, needs the network) also fails when the registry has a newer version
 * of an @abstractframework/* dependency in the same major.minor than the lock resolves (a
 * published patch the app has not relocked to).
 *
 *   node scripts/check_lock.mjs [--latest] [--dir <app dir>]
 *
 * Plain Node, no dependency. Identical copy in AbstractCode (web), AbstractFlow, AbstractObserver,
 * AbstractContinuum and AbstractEntity.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const dirArg = args.indexOf("--dir");
const appDir = dirArg >= 0 ? resolve(args[dirArg + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const latest = args.includes("--latest");

const SCOPE = "@abstractframework/";
const SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const REGISTRY = "https://registry.npmjs.org/";

const pkg = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(join(appDir, "package-lock.json"), "utf8"));
const problems = [];

function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v || "").trim());
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || "" } : null;
}
function cmp(a, b) {
  for (const k of ["major", "minor", "patch"]) if (a[k] !== b[k]) return a[k] - b[k];
  if (a.pre === b.pre) return 0;
  if (!a.pre) return 1; // 1.0.0 > 1.0.0-dev.1
  if (!b.pre) return -1;
  return a.pre < b.pre ? -1 : 1;
}
function floorOf(spec) {
  const m = /^\s*(?:\^|~|>=|=)?\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*$/.exec(String(spec));
  return m ? parse(m[1]) : null;
}
const fmt = (v) => `${v.major}.${v.minor}.${v.patch}${v.pre ? `-${v.pre}` : ""}`;

// 1. The lock's root entry mirrors package.json.
const root = (lock.packages || {})[""];
if (!lock.packages || !root) {
  problems.push(`package-lock.json has no packages[""] entry (lockfileVersion ${lock.lockfileVersion}); run npm install with npm 7 or later`);
} else {
  if (root.name !== pkg.name) problems.push(`lock name ${JSON.stringify(root.name)} ≠ package.json ${JSON.stringify(pkg.name)}`);
  if (root.version !== pkg.version) problems.push(`lock version ${root.version} ≠ package.json ${pkg.version} (run npm install)`);
  for (const section of SECTIONS) {
    const want = pkg[section] || {};
    const have = root[section] || {};
    for (const name of new Set([...Object.keys(want), ...Object.keys(have)])) {
      if (want[name] !== have[name]) {
        problems.push(
          `${section}.${name}: package.json ${want[name] === undefined ? "(absent)" : JSON.stringify(want[name])}, ` +
            `package-lock.json ${have[name] === undefined ? "(absent)" : JSON.stringify(have[name])} — the lock lags package.json (run npm install)`,
        );
      }
    }
  }
}

// 2 + 3. Every @abstractframework/* dependency: present, at/above the floor, same major.minor, from the registry.
const direct = {};
for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
  for (const [name, spec] of Object.entries(pkg[section] || {})) if (name.startsWith(SCOPE)) direct[name] = spec;
}
const entries = Object.entries(lock.packages || {});
const resolvedTop = {};
for (const [name, spec] of Object.entries(direct)) {
  const floor = floorOf(spec);
  if (!floor) {
    problems.push(`${name}: package.json spec ${JSON.stringify(spec)} has no version floor (use ^x.y.z)`);
    continue;
  }
  const entry = (lock.packages || {})[`node_modules/${name}`];
  if (!entry) {
    problems.push(`${name}: not in package-lock.json (run npm install)`);
    continue;
  }
  const got = parse(entry.version);
  if (entry.link || !got) {
    problems.push(`${name}: the lock links it (${entry.resolved || "no version"}) — an app installs the published package`);
    continue;
  }
  resolvedTop[name] = got;
  if (cmp(got, floor) < 0) problems.push(`${name}: lock resolves ${fmt(got)}, below package.json's floor ${fmt(floor)} (${spec})`);
  else if (got.major !== floor.major || got.minor !== floor.minor)
    problems.push(`${name}: lock resolves ${fmt(got)}, a different major.minor than package.json's ${spec}`);
  if (!String(entry.resolved || "").startsWith(REGISTRY))
    problems.push(`${name}: resolved from ${JSON.stringify(entry.resolved)}, not the npm registry (a local tarball goes stale on a same-version repack)`);
}
for (const [path, entry] of entries) {
  const at = path.lastIndexOf(`node_modules/${SCOPE}`);
  if (at <= 0 || !path.startsWith("node_modules/")) continue;
  const name = path.slice(at + "node_modules/".length);
  const top = resolvedTop[name];
  if (top && entry.version !== fmt(top)) problems.push(`${path}: nested copy ${entry.version} ≠ the app's ${name} ${fmt(top)} (two copies in one app; relock)`);
}

// --latest: the registry has no newer patch in the same major.minor.
if (latest) {
  for (const [name, got] of Object.entries(resolvedTop)) {
    let versions;
    try {
      versions = JSON.parse(execFileSync("npm", ["view", name, "versions", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    } catch (e) {
      problems.push(`${name}: npm view failed (${String(e.message).split("\n")[0]}) — --latest needs the registry`);
      continue;
    }
    const newer = [].concat(versions).map(parse).filter((v) => v && !v.pre && v.major === got.major && v.minor === got.minor && cmp(v, got) > 0);
    if (newer.length) problems.push(`${name}: lock resolves ${fmt(got)}, the registry has ${fmt(newer.sort(cmp).at(-1))} (relock: npm install ${name}@${fmt(newer.at(-1))})`);
  }
}

const summary = Object.entries(resolvedTop).map(([n, v]) => `${n.slice(SCOPE.length)} ${fmt(v)}`).join(", ");
if (problems.length) {
  console.error(`check_lock: FAILED (${appDir})`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`check_lock: OK — package-lock.json matches package.json; ${summary || "no @abstractframework dependency"}${latest ? "; no newer published patch" : ""}`);
