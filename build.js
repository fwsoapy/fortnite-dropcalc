#!/usr/bin/env node
/* Builds drop-solver.html from template.html.
 *
 * Three things get inlined, and the reason is always the same one: the output
 * has to be a single file that works from file:// with no network and no
 * server at all.
 *
 *   solver.js          the physics, so there is exactly one copy of it
 *   map_embed.jpg      Battle Royale island, refreshed from the API at runtime
 *   og_map_embed.jpg   OG island, which no API serves, so this is the only copy
 *
 * Usage: node build.js [--out path]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const dir = __dirname;
const outArg = process.argv.indexOf('--out');
const out = outArg > -1 && process.argv[outArg + 1]
  ? path.resolve(process.argv[outArg + 1])
  : path.join(dir, 'drop-solver.html');

const read = (f) => {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) throw new Error(`${f} not found in ${dir}`);
  return p;
};

let html = fs.readFileSync(read('template.html'), 'utf8');

/* ---- the solver -------------------------------------------------------- */
/* Strip the two lines that only mean something to node: the module footer,
   and the 'use strict' the template already declares at the top of its own
   script block. Everything else goes in verbatim so the shipped physics and
   the tested physics cannot be different code. */
const SOLVER_MARK = '/*__SOLVER_JS__*/';
let solver = fs.readFileSync(read('solver.js'), 'utf8')
  .replace(/\nif \(typeof module !== 'undefined'[\s\S]*?\n}\n?$/, '\n')
  .replace(/^'use strict';\n/m, '');

if (/module\.exports/.test(solver)) throw new Error('module.exports survived the strip');
if (!html.includes(SOLVER_MARK)) throw new Error(`${SOLVER_MARK} missing from template.html`);
html = html.replace(SOLVER_MARK, () => solver.trim());

/* ---- the maps ---------------------------------------------------------- */
const maps = {
  '__MAP_DATA_URI__': 'map_embed.jpg',
  '__OG_MAP_DATA_URI__': 'og_map_embed.jpg'
};
for (const [key, file] of Object.entries(maps)) {
  if (!html.includes(key)) throw new Error(`placeholder ${key} missing from template.html`);
  const b64 = fs.readFileSync(read(file)).toString('base64');
  html = html.replace(key, () => `data:image/jpeg;base64,${b64}`);
}

/* ---- refuse to ship a half-built file ---------------------------------- */
const left = html.match(/__[A-Z_]+__/g);
if (left) throw new Error(`unreplaced placeholders: ${[...new Set(left)].join(', ')}`);
for (const fn of ['function solveRoute', 'function solveDescent', 'function maxReach']) {
  const n = html.split(fn).length - 1;
  if (n !== 1) throw new Error(`expected exactly one ${fn} in the output, found ${n}`);
}

fs.writeFileSync(out, html, 'utf8');
console.log(`built -> ${out}  (${Math.round(fs.statSync(out).size / 1024)} KB)`);
