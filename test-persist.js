/* Checks on the parts of the page that neither test.js nor simulate.js can see,
   because those two only import solver.js:

     1. persistence  - what survives a reload and, more importantly, what must NOT
     2. inlining     - the shipped page must carry solver.js verbatim
     3. map transform- the hardcoded world-to-image fit must still be right

   This reads drop-solver.html, the BUILT file, not template.html. The template
   is only half a program now: the physics is a placeholder that build.js fills
   in from solver.js, so the template on its own has no CONFIG and no solver to
   test. Reading the build also means these checks run against the exact bytes
   that get published. Everything is pulled out by regex so the SHIPPED code is
   what runs here, never a copy of it. */
const fs = require('fs');
const { execFileSync } = require('child_process');

const BUILT = __dirname + '/drop-solver.html';
if (!fs.existsSync(BUILT)) {
  console.log('  drop-solver.html missing, building it first');
  execFileSync(process.execPath, [__dirname + '/build.js'], { stdio: 'inherit' });
}
const src = fs.readFileSync(BUILT, 'utf8');

const grab = (label, re) => {
  const m = src.match(re);
  if (!m) throw new Error('could not extract ' + label + ' from drop-solver.html');
  return m[0];
};

/* CONFIG arrives in two pieces now: the solver's, inlined from solver.js, and
   the UI-only keys the page merges onto it. Anything reading modes_ui or
   storeKey needs both, so always rebuild it through here. */
const grabConfig = () =>
    grab('CONFIG', /const CONFIG = \{[\s\S]*?\n\};/) + '\n'
  + grab('UI config', /Object\.assign\(CONFIG, \{[\s\S]*?\n\}\);/);

let fail = 0, pass = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
};
const near = (name, a, b, tol) => ok(name + '  (' + a + ' vs ' + b + ')', Math.abs(a - b) <= tol);

const code = [
  grabConfig(),
  grab('clamp',    /const clamp = [^\n]*/),
  grab('folderOf', /const folderOf = [^\n]*/),
  grab('save',     /function save\(\)\{[\s\S]*?\n\}/),
  grab('load',     /function load\(\)\{[\s\S]*?\n\}/)
].join('\n');

function makeEnv(stored){
  const store = {};
  if (stored !== undefined) store['k'] = JSON.stringify(stored);
  const sandbox = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; }
    },
    __raw: () => store.k,
    S: { markers:{busStart:{x:0.20,y:0.28}, busEnd:{x:0.82,y:0.66}, target:{x:0.50,y:0.50}},
         drops:[], folders:[], wallOffset:0 },
    console
  };
  const keys = Object.keys(sandbox);
  const fn = new Function(...keys,
    code + '\n; CONFIG.storeKey = "k"; return {S, load, save, CONFIG, raw:__raw};');
  return fn(...keys.map(k => sandbox[k]));
}

console.log('\n' + '='.repeat(74) + '\n  persistence: only user input is stored\n' + '='.repeat(74));

/* The bug that shipped three times, in its final form: a browser holding an
   older build's constants must not be able to override the current ones. There
   is now nothing to override with, so this is checked structurally. */
{
  const env = makeEnv(undefined);
  env.S.wallOffset = 4;
  env.S.drops = [{name:'tilted'}];
  env.save();
  const written = JSON.parse(env.raw());
  const keys = Object.keys(written).sort();
  ok('exactly four things are written: ' + keys.join(', '),
     keys.length === 4 && keys.join(',') === 'drops,folders,markers,wallOffset');
  for (const banned of ['settings','touched','modes','busSpeed','minGlideTime',
                        'allowEarlyDeploy','transform','calib','elevation','dropHeight'])
    ok('"' + banned + '" is never persisted', !(banned in written));
}

/* A payload written by an older build, complete with the constants it used to
   store, must be ignored except for the three fields that are still real. */
{
  const env = makeEnv({
    markers:{busStart:{x:0.11,y:0.12}, busEnd:{x:0.88,y:0.77}, target:{x:0.44,y:0.55}},
    settings:{ minGlideTime:1.5, busSpeed:73.3, allowEarlyDeploy:false, dropHeight:7.2,
               modes:{DIVE:{vh:14.5,vv:32}, GLIDE:{vh:17,vv:7}, FREEFALL:{vh:9,vv:60}} },
    touched:{ minGlideTime:true },
    transform:{a:1,b:2,c:3,d:4,e:5,f:6},
    drops:[{name:'my drop', busStart:{x:.1,y:.1}, busEnd:{x:.9,y:.9}, target:{x:.5,y:.5}}],
    elevation:999, wallOffset:3
  });
  env.load();
  ok('markers from the old payload still load', env.S.markers.busEnd.x === 0.88);
  ok('saved drops still load', env.S.drops.length === 1);
  near('wall offset still loads', env.S.wallOffset, 3, 1e-9);
  ok('no settings object is created', env.S.settings === undefined);
  near('minGlideTime comes from CONFIG, not the stored 1.5',
    env.CONFIG.minGlideTime, 2.2, 1e-9);
  near('busSpeed comes from CONFIG, not the stored 73.3',
    env.CONFIG.busSpeed, 100, 1e-9);
  near('DIVE.vh comes from CONFIG, not the stored 14.5',
    env.CONFIG.modes.DIVE.vh, require(__dirname + '/solver.js').CONFIG.modes.DIVE.vh, 1e-9);
  ok('allowEarlyDeploy comes from CONFIG, not the stored false',
    env.CONFIG.allowEarlyDeploy === true);
}

/* Hostile and malformed storage must never throw or poison state. */
for (const [label, payload] of [
  ['empty storage',            undefined],
  ['null markers',             {markers:null, drops:null, wallOffset:null}],
  ['markers missing a point',  {markers:{busStart:{x:0.1,y:0.1}}}],
  ['NaN coordinates',          {markers:{busStart:{x:'a',y:0.1}, busEnd:{x:0.9,y:0.9}, target:{x:0.5,y:0.5}}}],
  ['drops not an array',       {drops:'nope'}],
  ['wallOffset out of range',  {wallOffset:9999}],
  ['wallOffset NaN',           {wallOffset:'x'}]
]) {
  const env = makeEnv(payload);
  let threw = null;
  try { env.load(); } catch(e){ threw = e.message; }
  ok(label + ': load does not throw', threw === null);
  const m = env.S.markers;
  ok(label + ': markers stay finite',
    [m.busStart, m.busEnd, m.target].every(p => p && isFinite(p.x) && isFinite(p.y)));
  ok(label + ': wall offset stays in range',
    Number.isFinite(env.S.wallOffset) &&
    Math.abs(env.S.wallOffset) <= env.CONFIG.wallRange);
  ok(label + ': drops is an array', Array.isArray(env.S.drops));
}

/* Saved drops are UNLIMITED, but anything that is not a usable drop is dropped
   rather than trusted, since it comes back from storage. */
{
  const pt = {x:0.5, y:0.5};
  const good = Array.from({length:250}, (_,i) =>
    ({name:'d'+i, busStart:pt, busEnd:pt, target:pt}));
  const env = makeEnv({drops:good});
  env.load();
  ok('250 saved drops all survive, there is no cap', env.S.drops.length === 250);

  const env2 = makeEnv({drops:[
    {name:'ok',      busStart:pt, busEnd:pt, target:pt},
    {name:'no target', busStart:pt, busEnd:pt},
    {busStart:pt, busEnd:pt, target:pt},                 // nameless
    {name:'bad coords', busStart:{x:'a',y:1}, busEnd:pt, target:pt},
    null, 'nope', 42
  ]});
  env2.load();
  ok('malformed drops are discarded, the good one is kept',
    env2.S.drops.length === 1 && env2.S.drops[0].name === 'ok');
}

/* Folders persist, and a folder a drop names is re-created if the list lost it,
   so a drop can never be filed somewhere with no row to reach it. */
{
  const pt = {x:0.5, y:0.5};
  const env = makeEnv({
    folders:['Alpha', '  ', 'Beta', 7],
    drops:[{name:'a', folder:'Alpha', busStart:pt, busEnd:pt, target:pt},
           {name:'b', folder:'Ghost', busStart:pt, busEnd:pt, target:pt}]
  });
  env.load();
  ok('valid folders load and junk entries are dropped',
    env.S.folders.includes('Alpha') && env.S.folders.includes('Beta') &&
    !env.S.folders.includes(7) && !env.S.folders.includes('  '));
  ok('a folder named only by a drop is re-created', env.S.folders.includes('Ghost'));
  ok('no drop ends up in a folder with no row',
    env.S.drops.every(d => !d.folder || env.S.folders.includes(d.folder)));
}

console.log('\n' + '='.repeat(74) + '\n  the shipped page carries solver.js verbatim\n' + '='.repeat(74));

/* This used to be a long list of constant-by-constant comparisons, because the
   solver was written out twice and the two copies had to be talked into
   agreeing. They no longer can disagree: build.js inlines solver.js into the
   page, so the only thing worth checking is that the inlining actually
   happened and that nothing was mangled on the way in.

   That old comparison, for the record, was never enough. It compared numbers.
   A logic change made in one copy and not the other passed it every time, and
   one had in fact drifted: solveRoute dropped canCut on the floor in solver.js
   while the page forwarded it, so OG routes solved in node came back with the
   glider cut allowed in a mode that cannot cut. */
{
  const solver = fs.readFileSync(__dirname + '/solver.js', 'utf8');
  const body = solver
    .replace(/\nif \(typeof module !== 'undefined'[\s\S]*?\n}\n?$/, '\n')
    .replace(/^'use strict';\n/m, '')
    .trim();

  ok('solver.js is present in the built page, byte for byte', src.includes(body));
  ok('no placeholder was left behind', !src.includes('__SOLVER_JS__'));

  /* One definition of each. Two would mean the old duplicate crept back in,
     and whichever one parsed last would silently be the one that runs. */
  for (const fn of ['function solveRoute', 'function solveDescent', 'function maxReach',
                    'const CONFIG = {'])
    ok('exactly one ' + fn.replace(/[{]$/, '').trim(), src.split(fn).length - 1 === 1);

  /* The page must not have kept a private copy of any speed. Every number the
     solver uses has to come from the inlined CONFIG. */
  const afterConfig = src.slice(src.indexOf('Object.assign(CONFIG, {'));
  ok('no flight speeds redefined outside the solver',
     !/\bvh\s*:\s*\d/.test(afterConfig.replace(/speeds:\{[\s\S]*?\}\}/g, '')));
}

/* The solver as it actually runs inside the page, driven through the same
   distance sweep the two copies used to be compared over. Now it is checked
   against the node module to prove the inlined copy still behaves, which
   catches a build that mangles the source rather than a source that drifts. */
{
  const phys = [
    grab('CONFIG',       /const CONFIG = \{[\s\S]*?\n\};/),
    grab('EPS',          /const EPS = [^\n]*/),
    grab('ratio',        /const ratio = [^\n]*/),
    grab('maxReach',     /function maxReach\(cfg, H\) \{[\s\S]*?\n\}/),
    grab('solveDescent', /function solveDescent\(cfg, H, d\) \{[\s\S]*?\n\}/)
  ].join('\n');
  const shipped = new Function(phys + '\n; return {solveDescent, CONFIG};')();
  const mod = require(__dirname + '/solver.js');
  const cfgOf = (C) => ({ modes:C.modes, autoDeployAltitude:C.autoDeployAltitude,
    minGlideTime:C.minGlideTime, landingRedeployAltitude:C.landingRedeployAltitude,
    landingRedeployTime:C.landingRedeployTime, allowEarlyDeploy:C.allowEarlyDeploy });
  let worst = 0, checked = 0, mismatched = 0;
  for (const H of [400, 830, 1200]) for (let d = 0; d < 2600; d += 25) {
    const a = shipped.solveDescent(cfgOf(shipped.CONFIG), H, d);
    const b = mod.solveDescent(cfgOf(mod.CONFIG), H, d);
    checked++;
    if ((a === null) !== (b === null)) { mismatched++; continue; }
    if (!a) continue;
    worst = Math.max(worst, Math.abs(a.time - b.time),
                            Math.abs(a.cutAltitude - b.cutAltitude));
    if (a.phases.map(p=>p.mode).join() !== b.phases.map(p=>p.mode).join()) mismatched++;
  }
  ok('reachability and phases agree across ' + checked + ' cases', mismatched === 0);
  ok('air time and cut altitude agree', worst < 1e-9);

  /* The bug the old constant comparison could not see, pinned so it cannot
     come back: a mode that cannot cut must not be handed a cut. */
  const route = { busStart:{x:0,y:0}, busEnd:{x:4000,y:0}, target:{x:2000,y:600},
                  busAltitude:830, terrainElevation:0, modes:mod.CONFIG.modes };
  ok('solveRoute honours canCut:false', mod.solveRoute({...route, canCut:false}).air.cut === false);
  ok('solveRoute still cuts by default', mod.solveRoute({...route}).air.cut === true);
}

console.log('\n' + '='.repeat(74) + '\n  map transform is still the measured one\n' + '='.repeat(74));
{
  const T = new Function(
      grab('MAP_TRANSFORM', /const MAP_TRANSFORM = \{[\s\S]*?\n\};/) + '\n'
    + grab('withInverse',   /const withInverse = \(t\) => \{[\s\S]*?\n\};/)
    + '\n; return withInverse(MAP_TRANSFORM);')();
  /* Measured by matching label-ink blob centroids in map_en.png against POI
     world coordinates: all 13 labelled POIs matched to a mean of 1.9 px. These
     are the blob centroids that fit produced, in 2048 px image space. */
  const measured = [
    ['Golden Grove',    77627.21,  15211.34, 1492, 1117],
    ['Heatwave Harbor',-84784,     57568,     418, 1397],
    ['Calamari Canyon',-74801.53,   1165.02,  485, 1024],
    ['Sunken Shores',  -16445.77,  89339.50,  870, 1607],
    ['Frosted Flats',   27575.12,  -2477.47, 1161, 1000],
    ['The Battlewoods',-30948,    -39412,     774,  756]
  ];
  let worst = 0;
  for (const [name, wx, wy, px, py] of measured) {
    const nx = T.a*wx + T.b*wy + T.c, ny = T.d*wx + T.e*wy + T.f;
    const e = Math.hypot(nx*2048 - px, ny*2048 - py);
    worst = Math.max(worst, e);
    ok(name + ' lands within 6 px of its label (' + e.toFixed(1) + ' px)', e < 6);
  }
  ok('worst POI error across the set is under 6 px (' + worst.toFixed(1) + ')', worst < 6);
  near('map spans the measured 3098.6 m', T.metresAcross, 3098.6, 0.1);
  ok('world +y maps to image down, as measured', T.e > 0);
  ok('no rotation or shear', T.b === 0 && T.d === 0);
  /* The inverse must actually invert. */
  const wx = 12345, wy = -67890;
  const nx = T.a*wx + T.c, ny = T.e*wy + T.f;
  const bx = T.inv.a*(nx - T.c) + T.inv.b*(ny - T.f);
  const by = T.inv.c*(nx - T.c) + T.inv.d*(ny - T.f);
  near('inverse round trips x', bx, wx, 1e-6);
  near('inverse round trips y', by, wy, 1e-6);
}

console.log('\n' + '='.repeat(74) + '\n  OG map is wired to its own island\n' + '='.repeat(74));
{
  const env = new Function(
      grab('MAP_TRANSFORM',     /const MAP_TRANSFORM = \{[\s\S]*?\n\};/) + '\n'
    + grab('OG_METRES_ACROSS',  /const OG_METRES_ACROSS = [^\n]*/) + '\n'
    + grab('OG_TRANSFORM',      /const OG_TRANSFORM = \{[\s\S]*?\n\};/) + '\n'
    + grab('withInverse',       /const withInverse = \(t\) => \{[\s\S]*?\n\};/) + '\n'
    + 'withInverse(MAP_TRANSFORM); withInverse(OG_TRANSFORM);\n'
    + grab('OG_TERRAIN_ELEVATION', /const OG_TERRAIN_ELEVATION = [^\n]*/) + '\n'
    + 'const EMBEDDED_MAP = "BR_IMAGE", EMBEDDED_MAP_OG = "OG_IMAGE";\n'
    + grab('MAPS',   /const MAPS = \{[\s\S]*?\n\};/) + '\n'
    + grab('mapFor', /const mapFor = [^\n]*/) + '\n'
    + '; return {MAPS, mapFor, OG_TRANSFORM, MAP_TRANSFORM};')();
  const {mapFor, OG_TRANSFORM: OG, MAP_TRANSFORM: BR} = env;

  ok('each mode gets its own image', mapFor('br').image !== mapFor('og').image);
  ok('OG uses the OG image',         mapFor('og').image === 'OG_IMAGE');
  ok('Battle Royale uses the BR image', mapFor('br').image === 'BR_IMAGE');
  ok('each mode gets its own transform', mapFor('br').transform !== mapFor('og').transform);
  ok('an unknown mode falls back to Battle Royale', mapFor('nope').transform === BR);

  /* Only the scale carries weight on the OG map, so it is centred and square.
     If a labelled OG render ever appears, this is what gets replaced. */
  ok('OG transform has no rotation or shear', OG.b === 0 && OG.d === 0);
  ok('OG transform is square (x and y share a scale)', OG.a === OG.e);
  ok('OG origin sits at the image centre', OG.c === 0.5 && OG.f === 0.5);
  ok('OG world +y maps to image down', OG.e > 0);
  ok('OG scale is no longer provisional, it was measured', !OG.provisional);
  near('OG metresAcross matches its own scale factor', 1/(OG.a*100), OG.metresAcross, 1e-6);

  /* MEASURED IN GAME. Standing in the middle of Salty Springs and marking the
     middle of three other POIs. These are the numbers the scale answers to, and
     the reason it is 2623.9 and not the Battle Royale figure it started as.
     POI positions are pixel centres in og_map.png, 2048 square. */
  const PX = {salty:[1125,1205], tilted:[736,975], paradise:[1622,1461], sunny:[1627,445]};
  const MEASURED = [['tilted',593], ['paradise',713], ['sunny',1162]];
  const mPerPx = OG.metresAcross/2048;
  let worstPct = 0;
  for (const [poi, metres] of MEASURED){
    const d = Math.hypot(PX[poi][0]-PX.salty[0], PX[poi][1]-PX.salty[1]) * mPerPx;
    const pct = Math.abs(d - metres)/metres*100;
    worstPct = Math.max(worstPct, pct);
    ok('Salty Springs to ' + poi + ' reads ' + metres + ' m in game, solver says '
       + d.toFixed(0) + ' m (' + pct.toFixed(1) + '%)', pct < 3);
  }
  ok('every in-game distance is within 3% (worst ' + worstPct.toFixed(1) + '%)', worstPct < 3);
  /* The one that would have shipped silently: the Chapter 1 island is much
     smaller than the modern one, so inheriting 3098.6 made OG read 15% long. */
  ok('OG does not simply reuse the Battle Royale span',
     Math.abs(OG.metresAcross - BR.metresAcross) > 300);
  ok('the OG island is smaller than the Battle Royale one',
     OG.metresAcross < BR.metresAcross);

  /* The whole point of the scale: a span across the image has to come back as
     that many metres. Half the image width is half the map. */
  const world = (t, nx, ny) => ({
    x: (t.inv.a*(nx - t.c) + t.inv.b*(ny - t.f))/100,
    y: (t.inv.c*(nx - t.c) + t.inv.d*(ny - t.f))/100
  });
  const a = world(OG, 0.25, 0.5), b = world(OG, 0.75, 0.5);
  near('half the OG image is half the map in metres',
       Math.hypot(b.x-a.x, b.y-a.y), OG.metresAcross/2, 1e-6);
  const c = world(OG, 0.5, 0.5);
  near('the OG image centre is the world origin', Math.hypot(c.x, c.y), 0, 1e-9);

  /* The inverse must actually invert, same as the Battle Royale one. */
  const wx = 45678, wy = -12345;
  const nx = OG.a*wx + OG.c, ny = OG.e*wy + OG.f;
  near('OG inverse round trips x', OG.inv.a*(nx-OG.c) + OG.inv.b*(ny-OG.f), wx, 1e-6);
  near('OG inverse round trips y', OG.inv.c*(nx-OG.c) + OG.inv.d*(ny-OG.f), wy, 1e-6);
}

console.log('\n' + '='.repeat(74) + '\n  landing ground height\n' + '='.repeat(74));
{
  const env = new Function(
      grab('MAP_TRANSFORM',        /const MAP_TRANSFORM = \{[\s\S]*?\n\};/) + '\n'
    + grab('OG_METRES_ACROSS',     /const OG_METRES_ACROSS = [^\n]*/) + '\n'
    + grab('OG_TRANSFORM',         /const OG_TRANSFORM = \{[\s\S]*?\n\};/) + '\n'
    + grab('OG_TERRAIN_ELEVATION', /const OG_TERRAIN_ELEVATION = [^\n]*/) + '\n'
    + 'const EMBEDDED_MAP = "BR", EMBEDDED_MAP_OG = "OG";\n'
    + grab('MAPS',   /const MAPS = \{[\s\S]*?\n\};/) + '\n'
    + grab('mapFor', /const mapFor = [^\n]*/) + '\n'
    + '; return {mapFor, OG_TERRAIN_ELEVATION};')();
  const {mapFor, OG_TERRAIN_ELEVATION: OGE} = env;
  const C0 = new Function(grabConfig() + '\n; return CONFIG;')();

  /* THIS SHIPPED WRONG TWICE, both times short. First OG had no POI feed so it
     landed at sea level; then the terrain was measured but the flight was still
     ending on the dirt beside the building instead of on its roof. In OG every
     metre of either costs 3.3 m of reach instead of Battle Royale's 0.16. */
  ok('OG does not land at sea level', OGE > 0);
  ok('OG landing height is physically plausible for terrain plus a building',
     OGE > 5 && OGE < 60);
  /* Terrain measured two ways: 25 m short against 17.5 m of modelled ground puts
     it at 25.0, and 12.5 s of freefall puts it at 27.5. On top of that sits the
     roof, because the pin goes on a building and the flight stops on top of it.
     A Fortnite house is two walls tall. */
  near('OG landing surface is measured terrain plus a two storey roof',
     OGE, 25.0 + 2*C0.wallHeight, 0.1);
  ok('which is a landing surface, not a terrain height', OGE > 25.0);
  ok('Battle Royale takes its ground from live POIs, not a constant',
     mapFor('br').elevation === null);
  ok('OG carries its own ground height', mapFor('og').elevation === OGE);

  /* The amplification that made a small assumption a big miss.

     THE OG RATIO MUST COME FROM OG'S OWN GLIDER, not from CONFIG.modes.GLIDE.
     That is the Battle Royale glider, and these are all claims about how OG
     pays for ground. It read the shared one while the two still happened to
     share a ratio, so it was quietly measuring the wrong mode. */
  const C = new Function(grabConfig() + '\n; return CONFIG;')();
  const r = (m) => m.vh/m.vv;
  const ogGlide = C.modes_ui.find(m => m.id === 'og').speeds.GLIDE;
  const brRatio = r(C.modes.FREEFALL), ogRatio = r(ogGlide);
  ok('a freefall ending barely pays for ground (' + brRatio.toFixed(2) + ')', brRatio < 0.3);
  ok('a glide ending pays dearly for it (' + ogRatio.toFixed(2) + ')', ogRatio >= 3);
  ok('so OG is at least 10x more sensitive to ground height than Battle Royale',
     ogRatio/brRatio > 10);
  near('the shortfall sea level was causing in OG', OGE*ogRatio, 98, 15);
  /* Split out, because they were found one at a time and each was a round trip
     to the game: terrain first, then the roof standing on it. */
  near('of which the roof alone is worth 23 m', 2*C0.wallHeight*ogRatio, 23, 2);

  /* The wall offset has to be able to cover the spread of real POI heights,
     since a single constant cannot be right everywhere. */
  const perWall = C.wallHeight * ogRatio;
  ok('one wall is worth a useful amount of OG reach (' + perWall.toFixed(1) + ' m)',
     perWall > 10 && perWall < 16);
  const coversUp = OGE + C.wallRange*C.wallHeight;
  ok('the slider reaches high ground (' + coversUp.toFixed(0) + ' m, POIs go to 61 m)',
     coversUp > 50);
  ok('and reaches sea level going down', OGE - C.wallRange*C.wallHeight < 0);
}

console.log('\n' + '='.repeat(74) + '\n  modes and per-island saved drops\n' + '='.repeat(74));
{
  const CONFIG = new Function(grabConfig() + '\n; return CONFIG;')();
  const byId = (id) => CONFIG.modes_ui.find(m => m.id === id);

  /* BATTLE ROYALE IS THE BASELINE AND ANOTHER MODE'S MEASUREMENT MUST NOT MOVE
     IT. OG measured a 5.0 m/s glider sink where CONFIG says 7.0. Editing the
     shared constant silently changed Battle Royale's cut altitude, its max reach
     and its jump lead at long offsets, so the override lives on the mode. */
  ok('Battle Royale declares no speed overrides', byId('br').speeds === undefined);
  ok('the shared glide is still the Battle Royale one',
     CONFIG.modes.GLIDE.vh === 23.2 && CONFIG.modes.GLIDE.vv === 7.0);
  ok('OG overrides the glider for itself',
     byId('og').speeds.GLIDE.vv === 5.0 && byId('og').speeds.GLIDE.vh === 15.0);
  ok('and overrides nothing else', Object.keys(byId('og').speeds).join() === 'GLIDE');
  /* BOTH numbers are OG's own now. The ratio used to be Battle Royale's, applied
     to OG's slower sink, and OG lands 25-30 m short of the pin on every drop
     when it is: OG cannot cut, so the 100 m auto-deploy window is all glide and
     is credited with 100 * ratio metres of ground every single time. */
  near('OG glides at its own ratio, measured from that constant shortfall',
     byId('og').speeds.GLIDE.vh / byId('og').speeds.GLIDE.vv, 3.0, 1e-9);
  ok('which is lower than Battle Royale\'s, and must not be copied back',
     byId('og').speeds.GLIDE.vh / byId('og').speeds.GLIDE.vv
     < CONFIG.modes.GLIDE.vh / CONFIG.modes.GLIDE.vv);
  near('and the gap is the 100 m window times the missing ratio',
     CONFIG.autoDeployAltitude * (CONFIG.modes.GLIDE.vh / CONFIG.modes.GLIDE.vv
       - byId('og').speeds.GLIDE.vh / byId('og').speeds.GLIDE.vv), 27.5, 4);
  ok('dive and freefall are untouched by any mode',
     CONFIG.modes.DIVE.vh === 20.4 && CONFIG.modes.DIVE.vv === 23.2
     && CONFIG.modes.FREEFALL.vh === 9.0 && CONFIG.modes.FREEFALL.vv === 56.2);
  /* The merge has to be per mode and shallow, never a mutation of CONFIG. */
  ok('speeds are merged onto a copy, not written into CONFIG',
     /Object\.assign\(\{\}, CONFIG\.modes, over\)/.test(src));
  ok('a mode with no overrides gets CONFIG untouched',
     /over \? Object\.assign\(\{\}, CONFIG\.modes, over\) : CONFIG\.modes/.test(src));
  ok('the solver is handed the mode\'s speeds, not the raw CONFIG',
     /modes:modeSpeeds\(S\.mode\)/.test(src) && !/modes:CONFIG\.modes/.test(src));

  ok('Battle Royale can cut the glider',  byId('br').canCut === true);
  ok('OG cannot cut the glider',          byId('og').canCut === false);
  ok('OG is selectable',                  byId('og').ready === true);
  ok('OG no longer warns about a missing map', !byId('og').noMap);
  /* Everything that touches fortnite-api.com is gated on this flag, so a mode
     that is not Battle Royale can never be handed its island or its POIs. */
  ok('only Battle Royale is marked live', byId('br').live === true && !byId('og').live);
  ok('the placeholder stays unselectable', byId('reload').ready === false);
  /* Blitz was removed from the picker outright, the way Ballistic was, rather
     than left greyed out. Reload is the only coming-soon row. */
  ok('Blitz is gone from the picker', byId('blitz') === undefined);
  /* Ballistic was removed from the picker outright, not just greyed out. */
  ok('Ballistic is gone from the picker', byId('ballistic') === undefined);

  const modeOf = new Function(grab('modeOf', /const modeOf = [^\n]*/) + '; return modeOf;')();
  ok('a drop saved before modes existed reads as Battle Royale', modeOf({name:'x'}) === 'br');
  ok('an OG drop reads as OG',            modeOf({name:'x', mode:'og'}) === 'og');
  ok('a nonsense mode field is not trusted as a real mode',
     !CONFIG.modes_ui.some(m => m.id === modeOf({name:'x', mode:''}) && !m.ready));

  /* The listing filter is what keeps a Battle Royale pin from being offered on
     the OG island, where it would point at open water. */
  const S = {mode:'og', drops:[{name:'a'}, {name:'b', mode:'og'}, {name:'c', mode:'br'}]};
  const dropsHere = new Function('S', 'modeOf',
    grab('dropsHere', /const dropsHere = [^\n]*/) + '; return dropsHere();');
  ok('OG lists only OG drops',
     dropsHere(S, modeOf).map(([d]) => d.name).join() === 'b');
  S.mode = 'br';
  ok('Battle Royale lists its own plus untagged legacy ones',
     dropsHere(S, modeOf).map(([d]) => d.name).join() === 'a,c');
}

console.log('\n' + '='.repeat(74) + '\n  the live map actually refreshes\n' + '='.repeat(74));
{
  /* THE REFRESH LOOKED LIKE IT WORKED AND DID NOTHING.

     fortnite-api.com serves the island from one static URL, /images/map.png,
     under Cache-Control: public, max-age=31536000. A year. The JSON request
     asks for no-store so the metadata stays fresh, but the image is a plain
     img.src, so any browser already holding map.png would never ask for it
     again and a new season's island would never arrive. Nothing would look
     broken, which is what made it worth a test.

     Last-Modified cannot key this: it was watched moving two days inside one
     session while the bytes stayed md5-identical, because it tracks the CDN
     edge and not the asset. So the URL carries a UTC day stamp.

     These pin the MECHANISM, not the map: no API call, no season, nothing
     that can rot. */
  const env = new Function(
    grab('dayStamp', /const dayStamp = [^\n]*/) + '\n'
    + grab('bustCache', /const bustCache = \(url\) =>\n[^\n]*/) + '\n'
    + '; return {dayStamp, bustCache};')();
  const url = 'https://fortnite-api.com/images/map.png';

  ok('the live map URL is cache busted', env.bustCache(url) !== url);
  ok('...with a query parameter, so the path still resolves',
     env.bustCache(url).startsWith(url + '?'));
  ok('...that is a UTC day stamp',
     /\?v=\d{4}-\d{2}-\d{2}$/.test(env.bustCache(url)), env.bustCache(url));
  ok('and the stamp is today, in UTC',
     env.dayStamp() === new Date().toISOString().slice(0, 10), env.dayStamp());

  /* Twice in one day must be ONE URL, or the 2.6 MB image is refetched on every
     load and embedding a map at all stops making sense. */
  ok('two loads the same day share a URL, so it is not refetched every time',
     env.bustCache(url) === env.bustCache(url));
  /* A different day must be a different URL, which is the entire point. */
  ok('a different day is a different URL',
     env.bustCache(url) !== url + '?v=2001-09-11');
  /* A URL that already carries a query must not get a second '?'. */
  ok('an existing query gets & rather than a second ?',
     env.bustCache(url + '?x=1') === url + '?x=1&v=' + env.dayStamp());

  /* It has to happen where the URL is CAPTURED, not where it is used:
     applyMapForMode() reuses liveMapImage when coming back from OG, so busting
     at the use site would leave that path on the raw URL. */
  ok('the live URL is busted at capture, so the OG round trip keeps it',
     /const url = bustCache\(d\.images\.blank\)/.test(src));
  ok('and liveMapImage only ever takes that busted URL',
     /liveMapImage = url;/.test(src));
  ok('and nothing assigns the raw API URL to liveMapImage',
     !/liveMapImage = d\.images\.blank/.test(src));
  /* The metadata request keeps its own no-store. Separate mechanism, and the
     one that was already right. */
  ok('the JSON request still asks for no-store', /cache:'no-store'/.test(src));

  /* A STALE MIRROR MUST NOT OVERWRITE A NEWER EMBEDDED ISLAND.

     On the day 42.00 shipped, fortnite-api.com was still serving the 41.x map
     with 41.x POI coordinates. The embedded island was cut from the live game,
     so an ungated swap pulled the OLD island back over the NEW one on every
     load: the refresh actively making the map worse. The guard refuses the one
     asset already known to be superseded, by byte count, and clears itself the
     moment the API publishes anything else.

     The decision is a pure predicate so it is tested for behaviour rather than
     spelling, and without a network. */
  const g = new Function(
    grab('SUPERSEDED_MAP_BYTES', /const SUPERSEDED_MAP_BYTES = \d+;/) + '\n'
    + grab('isSupersededMap', /const isSupersededMap = \(len\) =>\n[^\n]*/) + '\n'
    + '; return {isSupersededMap, SUPERSEDED_MAP_BYTES};')();

  near('the superseded length is the 41.x island, byte for byte',
     g.SUPERSEDED_MAP_BYTES, 2613644, 0);
  ok('the superseded island is refused', g.isSupersededMap(2613644) === true);
  ok('a different asset is accepted', g.isSupersededMap(3100000) === false);
  ok('one byte different is accepted, so it clears itself',
     g.isSupersededMap(2613645) === false);
  /* parseInt of a missing header is NaN, which must read as superseded. */
  ok('a missing content-length is refused, not guessed',
     g.isSupersededMap(NaN) === true);
  ok('an unparsable length is refused', g.isSupersededMap(parseInt('nope', 10)) === true);

  /* Wiring, which the predicate alone cannot show. */
  ok('the swap is gated on the guard',
     /if \(await liveMapIsNotSuperseded\(url\)\)\{/.test(src));
  ok('the guard asks for HEAD and no-store',
     /method:'HEAD', cache:'no-store'/.test(src));
  ok('a failed guard keeps the embedded map rather than swapping',
     /\}catch\(e\)\{ return false; \}/.test(
       (src.match(/async function liveMapIsNotSuperseded[\s\S]*?\n\}/) || [''])[0]));
  ok('an http error keeps the embedded map too',
     /if \(!res\.ok\) return false;/.test(src));
}

console.log('\n' + '='.repeat(74) + '\n  the built file carries both islands\n' + '='.repeat(74));
{
  const built = __dirname + '/drop-solver.html';
  if (!fs.existsSync(built)) {
    ok('drop-solver.html exists (run: node build.js)', false);
  } else {
    const out = fs.readFileSync(built, 'utf8');
    ok('no unreplaced map placeholder remains',
       !/__MAP_DATA_URI__|__OG_MAP_DATA_URI__/.test(out));
    const uris = out.match(/data:image\/jpeg;base64,[A-Za-z0-9+/=]+/g) || [];
    ok('two map images are embedded (' + uris.length + ')', uris.length === 2);
    /* The build inlines two files by name, so wiring both placeholders to the
       same image would embed one island twice and go completely unnoticed. */
    ok('the two embedded images are different', uris.length === 2 && uris[0] !== uris[1]);
  }
}

console.log('\n' + '='.repeat(74) + '\n  folder area outline\n' + '='.repeat(74));
{
  const geo = new Function(
      grab('hull',        /function hull\(pts\)\{[\s\S]*?\n\}/) + '\n'
    + grab('MITER_LIMIT', /const MITER_LIMIT = [^\n]*/) + '\n'
    + grab('expandPoly',  /function expandPoly\(h, pad\)\{[\s\S]*?\n\}/) + '\n'
    + grab('areaPolygon', /function areaPolygon\(pts, pad\)\{[\s\S]*?\n\}/)
    + '\n; return {hull, expandPoly, areaPolygon, MITER_LIMIT};')();

  const PAD = 34;
  const distToSeg = (p,q,r) => {
    const vx=r.x-q.x, vy=r.y-q.y, L2=vx*vx+vy*vy||1;
    let t=((p.x-q.x)*vx+(p.y-q.y)*vy)/L2; t=Math.max(0,Math.min(1,t));
    return Math.hypot(p.x-(q.x+vx*t), p.y-(q.y+vy*t));
  };
  /* Even-odd point in polygon, so "the pin is inside its own highlight" can be
     asserted without a browser. */
  const inside = (poly, p) => {
    let hit = false;
    for (let i = 0, j = poly.length-1; i < poly.length; j = i++){
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) &&
          p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y) + a.x) hit = !hit;
    }
    return hit;
  };
  const P = (arr) => arr.map(([x,y]) => ({x:x*1000, y:y*1000}));

  const cases = [
    ['a spread triangle',   P([[.20,.20],[.70,.42],[.62,.90]])],
    ['a tight cluster',     P([[.48,.47],[.55,.49],[.58,.54],[.55,.60],[.49,.61],[.44,.56],[.44,.50]])],
    ['two drops diagonal',  P([[.40,.40],[.60,.62]])],
    ['a single drop',       P([[.50,.50]])],
    ['three near collinear',P([[.30,.50],[.50,.502],[.70,.504]])],
    ['exactly collinear',   P([[.30,.50],[.50,.50],[.70,.50]])],
    ['duplicate positions', P([[.5,.5],[.5,.5],[.5,.5]])],
    ['a long thin sliver',  P([[.10,.50],[.90,.51],[.50,.53]])]
  ];
  for (const [label, pts] of cases){
    const poly = geo.areaPolygon(pts, PAD);
    ok(label + ': every drop sits inside its own highlight',
       pts.every(p => inside(poly, p)));
    const h = geo.hull(pts);
    const gaps = poly.map(v => Math.min(...h.map((a,j) =>
      distToSeg(v, a, h[(j+1)%h.length]))));
    /* Nothing may spike far from the drops. A square corner is pad*sqrt(2), so
       1.5x is the honest ceiling; before the miter limit was added a sharp
       triangle corner reached 2.8x and the shape flew off past the pins. */
    ok(label + ': no vertex spikes past 1.5x the pad ('
       + Math.max(...gaps).toFixed(0) + ' px)', Math.max(...gaps) <= PAD*1.5 + 0.5);
    ok(label + ': the outline never cuts inside the pad ('
       + Math.min(...gaps).toFixed(0) + ' px)', Math.min(...gaps) >= PAD - 0.5);
  }
  /* The old fake expansion was a stroke of width HULL_PAD*2, which rounded every
     corner and doubled the opacity where it overlapped the fill. Neither may
     come back. */
  ok('the expansion is real geometry, not a giant stroke',
     !/HULL_PAD\s*\*\s*2/.test(src));
  ok('the area path joins are mitered, not rounded',
     /'stroke-linejoin':'miter'/.test(src));
  /* One path element for the shape. The other --c-area fill is the per drop dot,
     which is a circle, so match the path's leading "d," to tell them apart. */
  ok('the area is one path with one fill opacity',
     (src.match(/\bd,\s*fill:'var\(--c-area\)'/g) || []).length === 1);
}

console.log('\n' + '='.repeat(74) + '\n  game modes\n' + '='.repeat(74));
{
  const C = makeEnv(undefined).CONFIG;
  const ids = C.modes_ui.map(m => m.id);
  ok('three rows in the picker: ' + ids.join(', '), C.modes_ui.length === 3);
  ok('Battle Royale and OG are selectable',
     C.modes_ui.filter(m => m.ready).map(m=>m.id).join(',') === 'br,og');
  ok('Reload is the only greyed row',
     C.modes_ui.filter(m => !m.ready).map(m=>m.id).join(',') === 'reload');
  ok('Battle Royale can cut the glider', C.modes_ui[0].canCut === true);
  ok('OG cannot', C.modes_ui[1].canCut === false);
  /* Placeholders must not carry physics: a mode with no measured map would
     otherwise silently solve against the wrong island. */
  ok('placeholders declare no physics',
     C.modes_ui.filter(m => !m.ready).every(m => m.canCut === undefined));
  ok('OG now has a map of its own, so the warning flag is gone',
     C.modes_ui[1].noMap === undefined);

  ok('the solver is told which ending to use', /canCut:modeDef\(S\.mode\)/.test(src));

  /* THE PICKER IS BUILT, NOT NATIVE. A <select> draws its popup with the OS
     colours: a white list inheriting the theme's near-white text, so every row
     except the highlighted one was invisible. That is not stylable. */
  /* Matched on the closing tag: the comment above the CSS mentions "<select>"
     in prose, and an opening-tag pattern hits that instead of real markup. */
  ok('no native select is used for the mode', !/<\/select>/.test(src));
  ok('the popup is a real listbox', /role="listbox"/.test(src));
  ok('rows carry their selected and disabled state for assistive tech',
     /aria-selected="/.test(src) && /aria-disabled="true"/.test(src));
  /* #panel has a backdrop-filter, which makes it a containing block for
     position:fixed children, so a popup nested inside it lands relative to the
     panel rather than the viewport. It has to live outside. */
  {
    const panel = (src.match(/<aside id="panel">[\s\S]*?<\/aside>/) || [''])[0];
    ok('the popup lives outside the panel, clear of its backdrop-filter',
       !/id="modeList"/.test(panel) && /id="modeList"/.test(src));
  }
  ok('it closes on outside click, resize and scroll',
     /if \(modesOpen\(\)\) closeModes\(false\)/.test(src));
  ok('and is keyboard operable', /ArrowDown/.test(src) && /'Escape'/.test(src));
  ok('arrow keys skip the greyed rows',
     /filter\(o => o\.getAttribute\('aria-disabled'\) !== 'true'\)/.test(src));
  ok('a disabled mode cannot be selected', /if \(!m\.ready\) return;/.test(src));
  ok('switching mode discards the previous answer',
     /S\.result = null; S\.stale = false;\n  applyMapForMode\(\);/.test(src));
  /* The island and the coordinate system have to change with the mode, or the
     pin keeps its pixel position on a map that means something else now. */
  ok('switching mode swaps the island too', /function applyMapForMode\(\)\{/.test(src)
     && /S\.transform = mapFor\(S\.mode\)\.transform;/.test(src));
  ok('and relists the drops, which are per island',
     /applyMapForMode\(\);\n  renderModes\(\); renderDrops\(\);/.test(src));
  ok('the boot path picks the island for the stored mode',
     /applyMapForMode\(\);\s+\/\/ stored mode picks its own island/.test(src));
  /* The API only ever describes Battle Royale, so both the island it returns
     and the POI elevations it carries must stop at the mode boundary. */
  ok('the live island is only swapped in for a live mode',
     /if \(modeDef\(S\.mode\)\.live\)\n\s*setMapImage\(liveMapImage/.test(src));
  /* Refused, but NOT replaced with sea level: that is what made OG land short. */
  ok('POI elevation snapping is refused off the live island',
     /if \(!modeDef\(S\.mode\)\.live\)\{ S\.elevation = mapFor\(S\.mode\)\.elevation \|\| 0; return; \}/
       .test(src));
  ok('and the island falls back to its own ground height, not zero',
     !/S\.elevation = 0; return;/.test(src));
  ok('the chosen mode is persisted', /wallOffset:S\.wallOffset, mode:S\.mode/.test(src));
  ok('and only restored if it is a real, ready mode',
     /CONFIG\.modes_ui\.some\(m => m\.id === o\.mode && m\.ready\)/.test(src));
  ok('shared links carry the mode', /mode: \(typeof a\[17\] === 'string'/.test(src));
  ok('links made before modes existed still read as Battle Royale',
     /\(a\[17\] \|\| 'br'\) === 'br'/.test(src));
}

console.log('\n' + '='.repeat(74) + '\n  loading a drop leaves the bus path alone\n' + '='.repeat(74));
{
  const body = (src.match(/function loadDrop\(i\)\{[\s\S]*?\n\}/) || [''])[0];
  ok('loadDrop restores the target', /S\.markers\.target = \{\.\.\.d\.target\}/.test(body));
  ok('and the wall offset', /S\.wallOffset = /.test(body));
  /* The bus flies a different line every match, so a saved drop must not
     overwrite the route you just set from the current game. */
  ok('but never touches busStart', !/S\.markers\.busStart\s*=/.test(body));
  ok('and never touches busEnd', !/S\.markers\.busEnd\s*=/.test(body));
  /* Saving still records them, so old saves keep validating on load. */
  const sd = (src.match(/function saveDrop\(\)\{[\s\S]*?\n\}/) || [''])[0];
  ok('saving still records the route, so existing saves still load',
     /busStart:\{\.\.\.S\.markers\.busStart\}/.test(sd));
}

console.log('\n' + '='.repeat(74) + '\n  bus route chevrons and the swap control\n' + '='.repeat(74));
{
  const num = (name) => {
    const m = src.match(new RegExp(name + '\\s*=\\s*([\\d.]+)'));
    return m ? parseFloat(m[1]) : NaN;
  };
  const inset = num('ROUTE_INSET');
  const markerR = parseFloat((src.match(/r:(\d+(?:\.\d+)?), fill:'var\(--c-marker\)'/)||[])[1]);
  const half = num('ROUTE_HALF');
  /* The end markers must read as the ends of the line, not as another arrow in
     the band, so they are deliberately larger than a chevron. */
  /* The markers only need to stay a little bigger than a chevron so the ends of
     the line still read as ends. They were deliberately brought back down once
     the chevrons got thicker. */
  ok('the end markers are bigger than a chevron ('
     + (markerR*2) + ' px across vs ' + (half*2) + ')', markerR*2 > half*2);
  /* THE SETTLED CHEVRON: a 5 px stroked V on 8 px arms, spaced near 17 px at the
     default zoom. Thicker and closer than the original, with none of the dark
     edge that was tried alongside it. Pinned exactly, because this drifted three
     times and each time the reference had to be sent again. */
  const depth = num('ROUTE_DEPTH'), step = num('ROUTE_STEP'), wgt = num('ROUTE_W');
  ok('the chevron is the 8 px V (depth ' + depth + ', half ' + half + ')',
     depth === 8 && half === 8);
  ok('at the 5 px stroke weight (' + wgt + ')', wgt === 5);
  ok('and spaced about 13 px apart (' + step + ' px)', step >= 10 && step <= 16);
  /* Below the 8 px arm depth they stop reading as separate arrows and smear
     into a solid ribbon. */
  ok('which stays above the arm depth, so they stay separate arrows',
     step >= depth);
  ok('chevrons are inset clear of the end markers ('
     + inset + ' px vs a ' + markerR + ' px radius)', inset > markerR + 6);

  /* Stroked, not filled, and with no outline pass behind it. */
  ok('chevrons have no dark outline behind them', !/rgba\(3,12,28/.test(src));
  ok('a chevron is a stroked V, not a filled polygon',
     /stroke:'var\(--c-route\)'/.test(src) && /fill:'none', stroke:'var\(--c-route\)'/.test(src));

  /* Zooming must not breed arrows: the count comes from the route length in
     normalized map units, never from screen pixels. */
  /* Spacing is in SCREEN pixels, so zooming in lays down more chevrons and the
     band keeps its density instead of stretching apart. */
  ok('the chevron count comes from the on-screen span',
     /span\/ROUTE_STEP/.test(src));
  ok('and not from a fixed count in map units',
     !/normLen\s*\*\s*ROUTE_DENSITY/.test(src));
  ok('with a ceiling so a deep zoom cannot emit thousands of them',
     /Math\.min\(ROUTE_MAX/.test(src) && num('ROUTE_MAX') <= 600);

  ok('the route colour is blue, not the old cyan',
     /--c-route:\s*#4da3ff/.test(src) && !/--c-route:\s*#00c8ff/.test(src));

  ok('a swap control exists at the route midpoint', /data-swap/.test(src));
  /* THE GLYPH IS THE BADGE. Not a disc with an icon on it: the traced shape
     itself, filled blue and outlined white. A disc behind it was wrong twice. */
  ok('the traced glyph itself is the control, filled blue',
     /d:SWAP_GLYPH,\s*\n?\s*fill:'var\(--c-marker\)'/.test(src));
  ok('with a thin white outline on that shape',
     /stroke:'#ffffff', 'stroke-width':1.5, 'stroke-linejoin':'round'/.test(src));
  ok('and no disc drawn behind it',
     !/r:SWAP_R, fill:'var\(--c-marker\)'/.test(src)
     && !/r:SWAP_R, fill:'none'/.test(src));
  ok('the outline stays 2 px on screen despite the scale transform',
     /'vector-effect':'non-scaling-stroke'/.test(src));
  ok('and fills with nonzero so the centre dot is not punched out',
     /'fill-rule':'nonzero'/.test(src));
  {
    const g = (src.match(/const SWAP_GLYPH = '([^']+)'/) || [])[1] || '';
    ok('the traced path has both pieces', (g.match(/M/g) || []).length === 2);
    ok('and is real traced geometry, not a stub', g.length > 800);
  }
  ok('the chevron band leaves a hole for it',
     /Math\.abs\(s - half\) < gap/.test(src));
  ok('it is clickable rather than decorative',
     /#overlay \.swap\{pointer-events:auto/.test(src));
  /* It must stop the event, otherwise pressing it also starts a map pan. */
  const h = (src.match(/if \(e\.target\.closest\('\[data-swap\]'\)\)\{[\s\S]*?\n  \}/) || [''])[0];
  ok('pressing it swaps start and end', /busStart = S\.markers\.busEnd/.test(h));
  ok('and stops the event so it does not also pan the map',
     /e\.stopPropagation\(\)/.test(h));
  ok('and saves, so the swap survives a reload', /save\(\)/.test(h));
}

console.log('\n' + '='.repeat(74) + '\n  no debug surface remains\n' + '='.repeat(74));
{
  for (const [what, re] of [
    ['no advanced panel markup',   /id="adv"/],
    ['no advanced panel styles',   /\.adv-card|\#adv\{/],
    ['no ctrl+shift+X handler',    /shiftKey[\s\S]{0,80}['"]x['"]/i],
    ['no renderAdv',               /function renderAdv/],
    ['no reset-constants button',  /advResetBtn/],
    ['no manual calibration',      /placeCalib|fitAffine|advCalib/],
    ['no file input',              /id="fileInput"/],
    ['no image drop zone',         /id="dz"/],
    ['no editable settings object',/S\.settings/]
  ]) ok(what, !re.test(src));
}

console.log('='.repeat(74));
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(74) + '\n');
process.exit(fail ? 1 : 0);
