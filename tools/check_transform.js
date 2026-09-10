#!/usr/bin/env node
/* Does the hardcoded world-to-image transform still fit the live island?
 *
 * MAP_TRANSFORM is measured offline and baked into template.html. Nothing in
 * the app re-derives it, so if Epic re-renders the island at different world
 * bounds the page keeps working, keeps pulling the new map art live, keeps
 * placing POIs, and every distance it reports is quietly wrong. That is the
 * one failure mode here that produces a confident wrong answer instead of an
 * error, and the project has already paid for the same mistake once by
 * inheriting a scale across islands.
 *
 * So: pull the live POIs, push them through the transform, and check they
 * still land where an island's worth of POIs should. This is an alarm, not a
 * measurement. It cannot tell you the new transform, only that the old one
 * has stopped fitting. Re-measure with the scripts in this directory when it
 * fires.
 *
 * Run: node tools/check_transform.js
 * Exit 0 fits, 1 drifted, 2 could not check (network, API shape).
 *
 * THE THRESHOLDS BELOW ARE DELIBERATELY LOOSE. They are set to catch an
 * island re-rendered at different bounds, not to detect a POI moving. Tighten
 * them against a few real runs: every run prints the measured values, so the
 * workflow log is the record of what normal looks like.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const API = 'https://fortnite-api.com/v1/map';
const TIMEOUT_MS = 20000;

/* Bounds a correctly fitted transform has to satisfy. */
const LIMITS = {
  inside:      { lo: -0.05, hi: 1.05 },  // every POI lands on the image
  spanFrac:    { lo: 0.30,  hi: 1.00 },  // POI cloud covers this much of it
  centroid:    { lo: 0.25,  hi: 0.75 },  // and sits roughly in the middle
  minPois:     8                          // below this, do not judge anything
};

const die = (code, msg) => { console.error(msg); process.exit(code); };

/* The transform is read out of template.html rather than duplicated here, so
   this check can never be testing a stale copy of the numbers. */
function readTransform() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'template.html'), 'utf8');
  const m = src.match(/const MAP_TRANSFORM = \{[\s\S]*?\n\};/);
  if (!m) die(2, 'could not find MAP_TRANSFORM in template.html');
  return new Function(m[0] + '; return MAP_TRANSFORM;')();
}

async function main() {
  const T = readTransform();
  console.log('transform: a=%s c=%s f=%s metresAcross=%s%s',
    T.a, T.c, T.f, T.metresAcross, T.provisional ? '  (flagged provisional)' : '');

  let data;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    const res = await fetch(API, { cache: 'no-store', signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) die(2, `api returned http ${res.status}`);
    data = (await res.json() || {}).data;
  } catch (e) {
    die(2, `could not reach ${API}: ${e.message}`);
  }
  if (!data) die(2, 'api payload had no data field');

  const pois = (data.pois || []).filter(p =>
    p && p.location && ['x','y','z'].every(k => isFinite(p.location[k])));
  if (pois.length < LIMITS.minPois)
    die(2, `only ${pois.length} usable POIs in the payload, not enough to judge`);

  /* The same projection the page does. */
  const pts = pois.map(p => ({
    name: p.name || p.id || '?',
    nx: T.a * p.location.x + T.b * p.location.y + T.c,
    ny: T.d * p.location.x + T.e * p.location.y + T.f
  }));

  const xs = pts.map(p => p.nx), ys = pts.map(p => p.ny);
  const stat = (v) => ({
    min: Math.min(...v), max: Math.max(...v),
    mean: v.reduce((a, b) => a + b, 0) / v.length
  });
  const X = stat(xs), Y = stat(ys);
  const spanX = X.max - X.min, spanY = Y.max - Y.min;

  console.log('pois: %d', pts.length);
  console.log('x: min %s max %s span %s centroid %s',
    X.min.toFixed(4), X.max.toFixed(4), spanX.toFixed(4), X.mean.toFixed(4));
  console.log('y: min %s max %s span %s centroid %s',
    Y.min.toFixed(4), Y.max.toFixed(4), spanY.toFixed(4), Y.mean.toFixed(4));
  console.log('implied POI extent: %s m across', (spanX * T.metresAcross).toFixed(0));

  const problems = [];

  const outside = pts.filter(p =>
    p.nx < LIMITS.inside.lo || p.nx > LIMITS.inside.hi ||
    p.ny < LIMITS.inside.lo || p.ny > LIMITS.inside.hi);
  if (outside.length)
    problems.push(`${outside.length} POI(s) project off the image, e.g. ` +
      outside.slice(0, 5).map(p => `${p.name} (${p.nx.toFixed(3)}, ${p.ny.toFixed(3)})`).join(', '));

  for (const [axis, span] of [['x', spanX], ['y', spanY]])
    if (span < LIMITS.spanFrac.lo || span > LIMITS.spanFrac.hi)
      problems.push(`POI spread on ${axis} is ${span.toFixed(3)} of the image, ` +
        `outside ${LIMITS.spanFrac.lo} to ${LIMITS.spanFrac.hi}`);

  for (const [axis, c] of [['x', X.mean], ['y', Y.mean]])
    if (c < LIMITS.centroid.lo || c > LIMITS.centroid.hi)
      problems.push(`POI centroid on ${axis} is ${c.toFixed(3)}, ` +
        `outside ${LIMITS.centroid.lo} to ${LIMITS.centroid.hi}`);

  if (!problems.length) {
    console.log('\nOK: the transform still fits the live island.');
    return;
  }
  console.error('\nThe transform no longer fits the live island:');
  for (const p of problems) console.error('  - ' + p);
  console.error(`
Epic has most likely re-rendered the island at different world bounds. Nothing
in the app detects this on its own: it would keep reporting distances, and they
would be wrong. Re-measure MAP_TRANSFORM with the scripts in this directory
(see tools/README.md) before trusting another answer out of the tool.`);
  process.exit(1);
}

main().catch(e => die(2, 'check failed to run: ' + (e && e.stack || e)));
