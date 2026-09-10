'use strict';
/* ==========================================================================
   INDEPENDENT VERIFICATION

   These do not re-run the solver's own assertions. They re-derive answers a
   second way (brute force over a fine grid, closed-form geometry, exhaustive
   sweeps) and check the solver agrees.
   ========================================================================== */
const S = require('./solver.js');
const { CONFIG } = S;

let pass = 0, fail = 0;
const f = (v,n) => (typeof v === 'number' ? v.toFixed(n === undefined ? 3 : n) : String(v));
function ok(name, cond, extra){
  if (cond) pass++;
  else { fail++; console.log('  FAIL  ' + name + (extra ? '   -> ' + extra : '')); }
}
const head = (t) => console.log('\n=== ' + t + ' ===');

const cfg = {
  modes: CONFIG.modes, autoDeployAltitude: CONFIG.autoDeployAltitude,
  minGlideTime: CONFIG.minGlideTime,
  landingRedeployAltitude: CONFIG.landingRedeployAltitude,
  landingRedeployTime: CONFIG.landingRedeployTime,
  allowEarlyDeploy: CONFIG.allowEarlyDeploy
};
const A = CONFIG.autoDeployAltitude;
const hMin = CONFIG.minGlideTime * CONFIG.modes.GLIDE.vv;
const rG = S.ratio(CONFIG.modes.GLIDE);

/* Deterministic PRNG so a failure is reproducible. */
let seed = 20260731;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const rng = (lo,hi) => lo + rnd()*(hi-lo);

/* ---------------------------------------------------------------- 1 */
head('1. Brute force: is the reported jump point really the best one?');
{
  let worst = 0, checked = 0, bad = 0;
  for (let t = 0; t < 400; t++){
    const H  = rng(330, 1330);
    const el = rng(0, 60);
    const ax = rng(-2000, 0), ay = rng(-2000, 2000);
    const bx = rng(500, 3000), by = rng(-2000, 2000);
    const tx = rng(-1500, 3000), ty = rng(-2500, 2500);
    const o = {...cfg, busStart:{x:ax,y:ay}, busEnd:{x:bx,y:by}, target:{x:tx,y:ty},
      busAltitude:H, terrainElevation:el, busSpeed:CONFIG.busSpeed,
      momentumTime:0, samples:4000};
    const r = S.solveRoute(o);
    if (!r.ok) continue;
    checked++;

    /* Re-derive the total time independently at 20001 points. */
    const L = Math.hypot(bx-ax, by-ay);
    const ux = (bx-ax)/L, uy = (by-ay)/L;
    const Hair = H - el;
    let best = Infinity, bestT = 0;
    for (let i = 0; i <= 20000; i++){
      const s = (i/20000) * L;
      const px = ax+ux*s, py = ay+uy*s;
      const d = Math.hypot(tx-px, ty-py);
      const air = S.solveDescent(cfg, Hair, d);
      if (!air) continue;
      const tot = s/CONFIG.busSpeed + air.time;
      if (tot < best){ best = tot; bestT = s/CONFIG.busSpeed; }
    }
    const err = r.total - best;
    if (err > 0.02) { bad++;
      if (bad < 4) console.log('        total ' + f(r.total) + ' vs brute ' + f(best)); }
    worst = Math.max(worst, err);
  }
  ok(`solver total matches a 20001-point brute force on all ${checked} random drops`,
    bad === 0, bad + ' mismatches, worst ' + f(worst,4) + ' s');
  console.log('  ' + checked + ' random solvable drops, worst gap vs brute force '
    + f(worst,4) + ' s');
}

/* ---------------------------------------------------------------- 2 */
head('2. Is every "out of range" verdict actually correct?');
{
  let wrong = 0, oor = 0, checked = 0;
  for (let t = 0; t < 3000; t++){
    const H  = rng(330, 1330), el = rng(0, 60);
    const ax = rng(-2000, 0), ay = rng(-2000, 2000);
    const bx = rng(500, 3000), by = rng(-2000, 2000);
    const tx = rng(-3000, 4000), ty = rng(-4000, 4000);
    const o = {...cfg, busStart:{x:ax,y:ay}, busEnd:{x:bx,y:by}, target:{x:tx,y:ty},
      busAltitude:H, terrainElevation:el, busSpeed:CONFIG.busSpeed,
      momentumTime:0, samples:3000};
    const r = S.solveRoute(o);
    checked++;
    /* Closest approach of the target to the SEGMENT, computed independently. */
    const L2 = (bx-ax)**2 + (by-ay)**2;
    let u = L2 > 0 ? ((tx-ax)*(bx-ax) + (ty-ay)*(by-ay)) / L2 : 0;
    u = Math.max(0, Math.min(1, u));
    const cx = ax + u*(bx-ax), cy = ay + u*(by-ay);
    const closest = Math.hypot(tx-cx, ty-cy);
    const reach = S.maxReach(cfg, H - el);

    if (!r.ok && r.reason === 'out-of-range'){
      oor++;
      /* Rejecting something inside reach would be the bug the user hit. */
      if (closest <= reach - 1e-6) { wrong++;
        if (wrong < 4) console.log('        rejected but closest ' + f(closest,0)
          + ' m <= reach ' + f(reach,0) + ' m'); }
    } else if (r.ok){
      if (closest > reach + 1e-6) wrong++;   // accepted something unreachable
    }
  }
  ok(`no drop inside max reach is ever rejected (${checked} cases)`, wrong === 0, String(wrong));
  console.log('  ' + checked + ' cases, ' + oor + ' genuinely out of range, '
    + wrong + ' misclassified');
}

/* ---------------------------------------------------------------- 3 */
head('3. Realistic map coverage: what fraction of the island is reachable?');
{
  const MAP = 3000;               // metres across, the app's fallback scale
  /* Last column is the minimum coverage expected. Routes that cross the island
     should reach essentially all of it. "edge clip" deliberately does not: it is
     a short route hugging one corner, so the opposite corner sits about 3.5 km
     away against a max reach of roughly 2.2 km. That shortfall is the physics,
     not the solver, and it tightened when GLIDE.vh was corrected from a fitted
     22 to the sourced 20, which is why this one carries its own bar. */
  const routes = [
    ['corner to corner', {x:0,y:0},            {x:MAP,y:MAP},         95],
    ['west to east',     {x:0,y:MAP/2},        {x:MAP,y:MAP/2},       95],
    ['north to south',   {x:MAP/2,y:0},        {x:MAP/2,y:MAP},       95],
    ['short diagonal',   {x:MAP*0.3,y:MAP*0.2},{x:MAP*0.7,y:MAP*0.6}, 95],
    ['edge clip',        {x:0,y:MAP*0.15},     {x:MAP*0.5,y:0},       70]
  ];
  for (const [name, a, b, floor] of routes){
    let reach = 0, tot = 0;
    for (let gx = 0; gx <= 20; gx++) for (let gy = 0; gy <= 20; gy++){
      const target = {x:gx/20*MAP, y:gy/20*MAP};
      const r = S.solveRoute({...cfg, busStart:a, busEnd:b, target,
        busAltitude:830, terrainElevation:0, busSpeed:CONFIG.busSpeed,
        momentumTime:0, samples:600});
      tot++; if (r.ok) reach++;
    }
    const pct = reach/tot*100;
    console.log('  ' + name.padEnd(18) + f(pct,1).padStart(6) + '% of the map reachable');
    ok(name + ': covers the expected share of the map', pct >= floor,
      f(pct,1)+'% vs a floor of '+floor+'%');
  }
}

/* ---------------------------------------------------------------- 4 */
head('4. Internal consistency on every solvable drop');
{
  let bad = 0, n = 0;
  for (let t = 0; t < 2000; t++){
    const H = rng(330,1330), el = rng(0,60);
    const a = {x:rng(-2000,0), y:rng(-2000,2000)};
    const b = {x:rng(500,3000), y:rng(-2000,2000)};
    const target = {x:rng(-1500,3000), y:rng(-2000,2000)};
    const r = S.solveRoute({...cfg, busStart:a, busEnd:b, target, busAltitude:H,
      terrainElevation:el, busSpeed:CONFIG.busSpeed, momentumTime:0, samples:800});
    if (!r.ok) continue;
    n++;
    const P = r.air.phases, Hair = H - el;
    const sumAlt = P.reduce((s,p)=>s+p.altitude,0);
    const sumT   = P.reduce((s,p)=>s+p.time,0);
    const sumD   = P.reduce((s,p)=>s+p.distance,0);
    const chk = [
      Math.abs(sumAlt - Hair) < 1e-6,
      Math.abs(sumT - r.air.time) < 1e-6,
      /* Tolerance is absolute-in-metres and these are hundreds of metres
         accumulated through a chain of subtractions, so 1e-4 m (a tenth of a
         millimetre) is the right scale. A tighter bound just measures double
         rounding. */
      Math.abs(sumD - r.airDistance) < 1e-4,
      Math.abs(r.total - (r.busTime + r.airTime)) < 1e-9,
      /* Four legs on an instant pull (glide, dive, glide, freefall), three
         otherwise (dive, glide, freefall). */
      P.length === (r.air.earlyDeploy ? 4 : 3),
      P.every(p => p.altitude >= -1e-9 && p.time >= -1e-9 && p.distance >= -1e-9),
      P.every(p => isFinite(p.altitude) && isFinite(p.time) && isFinite(p.distance)),
      /* mandatory bottom of the descent, identical on every drop */
      Math.abs(r.air.cutAltitude - (A - hMin)) < 1e-6,
      Math.abs(r.air.reopenAltitude - CONFIG.landingRedeployAltitude) < 1e-9,
      r.air.cut === true,
      P.find(p=>p.mode==='FREEFALL').time > 0,
      /* glide never below the forced minimum */
      P.find(p=>p.mode==='GLIDE').time >= CONFIG.minGlideTime - 1e-9,
      /* deploy altitude is one of the two legal values */
      Math.abs(r.air.deployAltitude - (r.air.earlyDeploy ? Hair : A)) < 1e-6,
      /* flown order matches the early-pull flag */
      P.map(p=>p.mode).join(',') === (r.air.earlyDeploy
        ? 'GLIDE_EARLY,DIVE,GLIDE,FREEFALL' : 'DIVE,GLIDE,FREEFALL'),
      /* the auto-deploy glide is always exactly the forced minimum */
      Math.abs(P.find(p=>p.mode==='GLIDE').time - CONFIG.minGlideTime) < 1e-9,
      /* an instant pull always has a real early glide leg */
      (!r.air.earlyDeploy) || P[0].time > 0,
      /* jump point lies on the segment */
      (() => { const L=Math.hypot(b.x-a.x,b.y-a.y);
        const cr=Math.abs((b.x-a.x)*(r.jumpPos.y-a.y)-(b.y-a.y)*(r.jumpPos.x-a.x))/L;
        return cr < 1e-6; })(),
      /* reported air distance really is exit to target */
      Math.abs(Math.hypot(target.x-r.exitPos.x, target.y-r.exitPos.y) - r.airDistance) < 1e-9
    ];
    if (!chk.every(Boolean)){ bad++;
      if (bad < 4) console.log('        first failing check index: '+chk.indexOf(false)); }
  }
  ok(`all invariants hold on ${n} solvable drops`, bad === 0, String(bad));
}

/* ---------------------------------------------------------------- 5 */
head('5. Monotonicity and continuity of the descent');
{
  const H = 830, R = S.maxReach(cfg, H);
  let tPrev = -Infinity, dPrev = -Infinity, jumps = 0, back = 0;
  for (let d = 0; d <= R; d += 0.5){
    const r = S.solveDescent(cfg, H, d);
    if (!r){ back++; continue; }
    if (r.time < tPrev - 1e-9) back++;
    if (tPrev > -Infinity && r.time - tPrev > 0.35) jumps++;   // discontinuity
    if (r.deployAltitude < dPrev - 1e-9) back++;
    tPrev = r.time; dPrev = r.deployAltitude;
  }
  ok('air time never decreases as the target gets further', back === 0, String(back));
  ok('no discontinuous jump in air time', jumps === 0, String(jumps)+' jumps');

  /* Exactly at the limit must solve; a metre past must not. */
  ok('solvable exactly at max reach', S.solveDescent(cfg, H, R) !== null);
  ok('not solvable one metre past it', S.solveDescent(cfg, H, R + 1) === null);
  ok('max reach is glide-limited', Math.abs(R - ((H-A)*rG + (hMin*rG
      + (A-hMin-CONFIG.landingRedeployAltitude)*S.ratio(CONFIG.modes.FREEFALL)
      + CONFIG.landingRedeployAltitude*rG))) < 1e-6, f(R,1)+' m');
}

/* ---------------------------------------------------------------- 6 */
head('6. Drop height and elevation behave sanely');
{
  const geom = {busStart:{x:0,y:0}, busEnd:{x:4000,y:0}, target:{x:2000,y:500}};
  let mono = true, prev = -Infinity;
  for (let h = 330; h <= 1330; h += 25){
    const R = S.maxReach(cfg, h);
    if (R < prev - 1e-9) mono = false;
    prev = R;
  }
  ok('more drop height always means more reach', mono);

  let elMono = true; prev = Infinity;
  for (let e = 0; e <= 300; e += 10){
    const R = S.maxReach(cfg, 830 - e);
    if (R > prev + 1e-9) elMono = false;
    prev = R;
  }
  ok('higher landing ground always means less reach', elMono);

  const lo = S.solveRoute({...cfg, ...geom, busAltitude:330, terrainElevation:0,
    busSpeed:CONFIG.busSpeed, momentumTime:0, samples:2000});
  const hi = S.solveRoute({...cfg, ...geom, busAltitude:1330, terrainElevation:0,
    busSpeed:CONFIG.busSpeed, momentumTime:0, samples:2000});
  ok('slider low end solves', lo.ok, lo.reason);
  ok('slider high end solves', hi.ok, hi.reason);

  /* Air time is NOT monotone in drop height once the regimes differ. The 500 m
     offset above is inside dive reach from 1330 m but far outside it from 330 m,
     and from 330 m the only way to cover the ground is a long slow glide. So the
     LOW drop takes longer. That is the physics, not a bug: dive reach scales with
     altitude, and gliding is much slower than falling.

     Compare like with like instead: a target both heights can dive to. */
  const nearGeom = {...geom, target:{x:2000, y:80}};
  const loN = S.solveRoute({...cfg, ...nearGeom, busAltitude:330, terrainElevation:0,
    busSpeed:CONFIG.busSpeed, momentumTime:0, samples:2000});
  const hiN = S.solveRoute({...cfg, ...nearGeom, busAltitude:1330, terrainElevation:0,
    busSpeed:CONFIG.busSpeed, momentumTime:0, samples:2000});
  ok('both heights dive to a near target without pulling early',
    !loN.air.earlyDeploy && !hiN.air.earlyDeploy);
  ok('and then a higher drop does take longer in the air', hiN.airTime > loN.airTime,
    f(loN.airTime,1)+' s at 330 m -> '+f(hiN.airTime,1)+' s at 1330 m');
  /* Whether it also holds when the two heights land in DIFFERENT regimes (one
     dives, one has to glide) depends on the constants, so it is reported rather
     than asserted. It inverted once already, at a shallower dive ratio. */
  console.log('  note: 500 m offset, low drop '
    + f(lo.airTime,1)+' s ('+(lo.air.earlyDeploy?'glides':'dives')+'), high drop '
    + f(hi.airTime,1)+' s ('+(hi.air.earlyDeploy?'glides':'dives')+')');
}

/* ---------------------------------------------------------------- 7 */
head('7. Degenerate and hostile inputs never produce garbage');
{
  const base = {...cfg, busSpeed:CONFIG.busSpeed, momentumTime:0, samples:200,
    busAltitude:830, terrainElevation:0};
  const cases = [
    ['zero length route', {busStart:{x:5,y:5}, busEnd:{x:5,y:5}, target:{x:9,y:9}}],
    ['target on the route', {busStart:{x:0,y:0}, busEnd:{x:1000,y:0}, target:{x:500,y:0}}],
    ['target on the start', {busStart:{x:0,y:0}, busEnd:{x:1000,y:0}, target:{x:0,y:0}}],
    ['ground above the bus', {busStart:{x:0,y:0}, busEnd:{x:1000,y:0}, target:{x:5,y:5},
      terrainElevation:900}],
    ['ground exactly at the bus', {busStart:{x:0,y:0}, busEnd:{x:1000,y:0},
      target:{x:5,y:5}, terrainElevation:830}],
    ['enormous route', {busStart:{x:-1e5,y:-1e5}, busEnd:{x:1e5,y:1e5}, target:{x:0,y:0}}],
    ['target very far away', {busStart:{x:0,y:0}, busEnd:{x:1000,y:0}, target:{x:1e6,y:1e6}}]
  ];
  for (const [name, o] of cases){
    let r;
    try { r = S.solveRoute({...base, ...o}); }
    catch(e){ ok(name + ': does not throw', false, e.message); continue; }
    ok(name + ': returns a well-formed result',
      r && (r.ok === true || typeof r.reason === 'string'), JSON.stringify(r).slice(0,70));
    if (r.ok){
      ok(name + ': no NaN in the answer',
        [r.total,r.busTime,r.airTime,r.airDistance].every(isFinite)
        && r.air.phases.every(p=>isFinite(p.time)&&isFinite(p.altitude)));
    }
  }
}

console.log('\n' + '='.repeat(70));
console.log(`  ${pass} checks passed, ${fail} failed`);
console.log('='.repeat(70));
process.exit(fail ? 1 : 0);
