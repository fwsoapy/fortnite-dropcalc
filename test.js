'use strict';
const S = require('./solver.js');
const { CONFIG } = S;

let pass = 0, fail = 0;
const f = (v, n) => (typeof v === 'number' ? v.toFixed(n === undefined ? 4 : n) : String(v));
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '   -> ' + extra : '')); }
}
function near(name, a, b, tol) {
  tol = tol === undefined ? 1e-6 : tol;
  ok(name, Math.abs(a - b) <= tol, `${f(a)} vs ${f(b)} (tol ${tol})`);
}
const head = (t) => console.log('\n=== ' + t + ' ===');

const D = CONFIG.modes.DIVE, G = CONFIG.modes.GLIDE, F = CONFIG.modes.FREEFALL;
const rD = S.ratio(D), rG = S.ratio(G), rF = S.ratio(F);
const H = 830, A = 100, MG = CONFIG.minGlideTime;
const hMin = MG * G.vv;                      // altitude the minimum glide eats

/* Strict config: no early pull. This is the regime the phase spec describes. */
const cfg  = { modes:CONFIG.modes, autoDeployAltitude:A, landingRedeployTime:0,
               minGlideTime:MG, allowEarlyDeploy:false };
const cfgE = { ...cfg, allowEarlyDeploy:true };
/* Sample distances as fractions of the no-early-pull reach rather than as fixed
   metres. Retuning the dive changes that reach (DIVE.vv 32 -> 60 took it from
   795 m to 455 m), and hardcoded distances silently fall out of range. */
const REACH = S.maxReach(cfg, H);
const SPAN = (n) => Array.from({length:n}, (_,i) => Math.round((i/(n-1)) * (REACH - 1)));
const px = (p, k) => p.find(x => x.mode === k);

/* ===================================================================== */
console.log('\n' + '='.repeat(78));
console.log('  THREE-PHASE DESCENT   H = ' + H + ' m,  auto-deploy = ' + A + ' m');
console.log('  dive ' + D.vh + '/' + D.vv + ' (r=' + rD.toFixed(3) + ')   ' +
            'glide ' + G.vh + '/' + G.vv + ' (r=' + rG.toFixed(3) + ')   ' +
            'freefall ' + F.vh + '/' + F.vv + ' (r=' + rF.toFixed(3) + ')');
console.log('  minimum glide before a cut: ' + MG + ' s = ' + hMin.toFixed(1) + ' m of altitude');
console.log('='.repeat(78));
console.log('   dist |  DIVE alt   time  |  GLIDE alt   time  | FREEFALL alt   time  |  total');
console.log('  ' + '-'.repeat(72));
for (const d of SPAN(7)) {
  const r = S.solveDescent(cfg, H, d);
  if (!r) { console.log('  ' + String(d).padStart(5) + ' |  OUT OF RANGE'); continue; }
  const [dv, gl, ff] = r.phases;
  console.log('  ' + d.toFixed(0).padStart(5) + ' | ' +
    dv.altitude.toFixed(0).padStart(7) + 'm' + dv.time.toFixed(1).padStart(7) + 's  | ' +
    gl.altitude.toFixed(0).padStart(8) + 'm' + gl.time.toFixed(1).padStart(7) + 's  | ' +
    ff.altitude.toFixed(0).padStart(9) + 'm' + ff.time.toFixed(1).padStart(7) + 's  | ' +
    r.time.toFixed(1).padStart(6) + 's');
}
console.log('  ' + '-'.repeat(72));
console.log('  Glide never drops below ' + hMin.toFixed(1) + ' m: the cut cannot happen instantly.');
console.log('  Freefall now carries ' + F.vh + ' m/s of horizontal, so it covers ground too.\n');

/* ===================================================================== */
head('phase order is fixed and always three rows');
for (const d of SPAN(4)) {
  const r = S.solveDescent(cfg, H, d);
  ok(`d=${d}: exactly 3 phases`, r.phases.length === 3);
  ok(`d=${d}: order is DIVE, GLIDE, FREEFALL`,
    r.phases.map(p => p.mode).join(',') === 'DIVE,GLIDE,FREEFALL');
}

head('MINIMUM GLIDE floor is enforced everywhere');
{
  let violations = 0, checked = 0;
  for (let d = 0; d <= S.maxReach(cfg, H); d += 3) {
    const r = S.solveDescent(cfg, H, d);
    checked++;
    if (px(r.phases, 'GLIDE').time < MG - 1e-9) violations++;
  }
  ok(`glide time >= ${MG}s for all ${checked} distances`, violations === 0, String(violations));

  const beneath = S.solveDescent(cfg, H, 0);
  near('directly beneath still glides the minimum', px(beneath.phases,'GLIDE').time, MG, 1e-9);
  near('...consuming exactly minGlideTime * glideVv of altitude',
    px(beneath.phases,'GLIDE').altitude, hMin, 1e-9);
  near('...and freefall gets the rest of the window',
    px(beneath.phases,'FREEFALL').altitude, A - hMin, 1e-9);
  ok('the solver never returns a glide shorter than the floor',
    px(beneath.phases,'GLIDE').time >= MG - 1e-9);

  /* Floor scales with the setting. */
  for (const mg of [0, 1.0, 1.5, 2.0, 3.0]) {
    const c = { ...cfg, minGlideTime: mg };
    const r = S.solveDescent(c, H, 0);
    near(`minGlideTime=${mg}: glide time matches the floor`,
      px(r.phases,'GLIDE').time, Math.min(mg, A / G.vv), 1e-9);
  }
  /* A floor bigger than the whole window clamps to the window. */
  const huge = S.solveDescent({ ...cfg, minGlideTime: 999 }, H, 0);
  near('an oversized floor clamps to the deploy window',
    px(huge.phases,'GLIDE').altitude, A, 1e-9);
  near('...leaving no freefall', px(huge.phases,'FREEFALL').altitude, 0, 1e-9);
}

head('FREEFALL carries horizontal distance');
{
  ok('freefall has a non-zero horizontal speed', F.vh > 0, String(F.vh));
  ok('freefall ratio is below the dive ratio', rF < rD, f(rF,3)+' vs '+f(rD,3));
  const r = S.solveDescent(cfg, H, 0);
  ok('freefall phase reports a distance field', 'distance' in px(r.phases,'FREEFALL'));

  /* At a distance the dive alone cannot cover, freefall must contribute. */
  const dTest = rD * (H - A) + 30;
  const q = S.solveDescent(cfg, H, dTest);
  ok('freefall contributes ground when it is part of the profile',
    px(q.phases,'FREEFALL').altitude > 0 ? px(q.phases,'FREEFALL').distance > 0 : true,
    f(px(q.phases,'FREEFALL').distance,1) + ' m');

  /* Freefall horizontal genuinely buys range. */
  const noFF = { ...cfg, modes:{ ...cfg.modes, FREEFALL:{ ...F, vh:0 } } };
  ok('freefall horizontal increases max reach',
    S.maxReach(cfg,H) > S.maxReach(noFF,H),
    f(S.maxReach(noFF,H),1)+' -> '+f(S.maxReach(cfg,H),1));
  near('the gain equals the freefall window times its ratio',
    S.maxReach(cfg,H) - S.maxReach(noFF,H), (A-hMin)*rF, 1e-9);
}

head('THE CUT IS MANDATORY on every drop');
{
  let missing = 0, checked = 0;
  for (let d = 0; d <= S.maxReach(cfgE, H); d += 7) {
    const r = S.solveDescent(cfgE, H, d);
    checked++;
    if (px(r.phases,'FREEFALL').time <= 0) missing++;
    if (r.cut !== true) missing++;
  }
  ok(`every one of ${checked} distances ends in a freefall phase`, missing === 0, String(missing));

  /* The bottom of the descent is identical for every drop. */
  const a = S.solveDescent(cfgE, H, 0), b = S.solveDescent(cfgE, H, 400),
        c = S.solveDescent(cfgE, H, 1400);
  /* GLIDE is now always the auto-deploy window glide; GLIDE_EARLY is the
     separate instant pull, so no subtraction is needed any more. */
  for (const [nm, r] of [['near',a],['mid',b],['far',c]]) {
    near(nm+': glide inside the window is exactly the floor',
      px(r.phases,'GLIDE').altitude, hMin, 1e-9);
    near(nm+': freefall altitude is always A - floor',
      px(r.phases,'FREEFALL').altitude, A - hMin, 1e-9);
    near(nm+': cut altitude is constant', r.cutAltitude, A - hMin, 1e-9);
  }
  /* Derived from the floor, not hardcoded, so tuning minGlideTime does not
     break the test. At the shipped 2.2 s that is 100 - 15.4 = 84.6 m. */
  near('cut altitude is exactly the window minus the forced glide',
    a.cutAltitude, A - hMin, 1e-9);
  ok('glide is never held longer than the floor before the cut',
    Math.abs(px(c.phases,'GLIDE').altitude - hMin) < 1e-9);
}

head('FLIGHT ORDER matches the instruction');
{
  const cfgE2 = {modes:CONFIG.modes, autoDeployAltitude:A, minGlideTime:MG,
    landingRedeployAltitude:CONFIG.landingRedeployAltitude,
    landingRedeployTime:0, allowEarlyDeploy:true};
  const near0 = S.solveDescent(cfgE2, H, 300);
  const far0  = S.solveDescent(cfgE2, H, 1400);

  ok('no early pull: rows read dive, glide, freefall',
    near0.phases.map(p=>p.mode).join(',') === 'DIVE,GLIDE,FREEFALL',
    near0.phases.map(p=>p.mode).join(','));
  /* Instant pull is four legs, and the two glides stay separate so the panel
     can show both: pull and glide, dive back down, auto-deploy glide, cut. */
  ok('early pull: four legs, glide, dive, glide, freefall, as flown',
    far0.phases.map(p=>p.mode).join(',') === 'GLIDE_EARLY,DIVE,GLIDE,FREEFALL',
    far0.phases.map(p=>p.mode).join(','));
  ok('early pull: the two glides are distinct rows',
    far0.phases.filter(p=>p.label === G.label).length === 2);
  near('early pull: the second glide is exactly the forced window',
    px(far0.phases,'GLIDE').time, MG, 1e-9);
  ok('no early pull: still three legs', near0.phases.length === 3);

  ok('no early pull: glider opens at the auto-deploy floor',
    Math.abs(near0.deployAltitude - A) < 1e-9, f(near0.deployAltitude,0)+' m');
  ok('early pull: glider opens straight off the bus, at the full drop',
    Math.abs(far0.deployAltitude - H) < 1e-9, f(far0.deployAltitude,0)+' m');
  ok('early pull reports where the dive begins',
    far0.diveFromAltitude > A && far0.diveFromAltitude < H,
    f(far0.diveFromAltitude,0)+' m');
  ok('no early pull has no separate dive-start altitude',
    near0.diveFromAltitude === null);

  /* Ground distance where the glider opens, for the map marker. */
  near('early pull opens at zero ground distance', far0.deployDistance, 0, 1e-9);
  near('no early pull opens after the dive leg',
    near0.deployDistance, px(near0.phases,'DIVE').distance, 1e-9);

  /* Reordering must not change any total. */
  near('early pull altitudes still sum to H',
    far0.phases.reduce((s,p)=>s+p.altitude,0), H, 1e-9);
  near('early pull times still sum to the total',
    far0.phases.reduce((s,p)=>s+p.time,0), far0.time, 1e-9);
  near('early pull distances still sum to d',
    far0.phases.reduce((s,p)=>s+p.distance,0), 1400, 1e-6);
  ok('the early glide leads the ground track when pulling early',
    far0.phases[0].mode === 'GLIDE_EARLY' && far0.phases[0].distance > 0);
}

head('AUTO-DEPLOY PREFERRED, early pull only when out of dive range');
{
  ok('early pull is available by default', CONFIG.allowEarlyDeploy === true);
  const cfgD = {modes:CONFIG.modes, autoDeployAltitude:A, minGlideTime:MG,
    landingRedeployAltitude:CONFIG.landingRedeployAltitude,
    landingRedeployTime:0, allowEarlyDeploy:true};
  const strict = {...cfgD, allowEarlyDeploy:false};
  const diveLimit = S.maxReach(strict, H);

  /* Anything a plain dive can reach must NOT pull early. */
  let earlyInside = 0, n = 0;
  for (let d = 0; d <= diveLimit; d += 5) {
    const r = S.solveDescent(cfgD, H, d);
    n++;
    if (r.earlyDeploy) earlyInside++;
    if (Math.abs(r.deployAltitude - A) > 1e-9) earlyInside++;
  }
  ok(`glider opens at exactly 100 m on all ${n} in-range distances`,
    earlyInside === 0, String(earlyInside));

  /* Past that it must pull early rather than declare the drop impossible. */
  let missed = 0, m = 0;
  for (let d = diveLimit + 10; d <= S.maxReach(cfgD, H); d += 20) {
    const r = S.solveDescent(cfgD, H, d);
    m++;
    if (!r) { missed++; continue; }
    if (!r.earlyDeploy) missed++;
    if (r.deployAltitude <= A) missed++;
  }
  ok(`all ${m} longer drops pull early instead of failing`, missed === 0, String(missed));

  /* The reach fix itself: turning early pull off wrongly rejects real drops. */
  /* The multiple depends on the dive ratio, so this asserts the qualitative
     claim rather than a threshold tuned to one set of constants: pulling early
     must more than double what a dive alone can reach. */
  ok('early pull massively extends reach',
    S.maxReach(cfgD,H) > diveLimit * 2,
    f(diveLimit,0)+' m -> '+f(S.maxReach(cfgD,H),0)+' m, '
      + f(S.maxReach(cfgD,H)/diveLimit,1)+'x');
  ok('a 900 m drop is reachable now', S.solveDescent(cfgD, H, 900) !== null);
  ok('...and was not before', S.solveDescent(strict, H, 900) === null);

  /* Deploy altitude rises smoothly with distance, no jumps. */
  let prev = -Infinity, mono = true;
  for (let d = 0; d <= S.maxReach(cfgD, H); d += 15) {
    const r = S.solveDescent(cfgD, H, d);
    if (r.deployAltitude < prev - 1e-9) mono = false;
    prev = r.deployAltitude;
  }
  ok('deploy altitude is monotone in distance', mono);

  /* The bottom of the descent is unchanged by an early pull. */
  const far = S.solveDescent(cfgD, H, 1400);
  near('far drop still auto-deploys the last window at 100 m',
    far.deployAltitude - (far.deployAltitude - A), A, 1e-9);
  near('far drop still cuts at the same altitude', far.cutAltitude, A - hMin, 1e-9);
  near('far drop still re-opens at 6 m', far.reopenAltitude, 6, 1e-9);
  ok('far drop still freefalls', px(far.phases,'FREEFALL').time > 0);
}

head('CUT ALTITUDE and the re-open at 6 m');
{
  const cfgD = {modes:CONFIG.modes, autoDeployAltitude:A, minGlideTime:MG,
    landingRedeployAltitude:CONFIG.landingRedeployAltitude,
    landingRedeployTime:0, allowEarlyDeploy:false};
  const r = S.solveDescent(cfgD, H, 300);
  near('glide is exactly the minimum before the cut', px(r.phases,'GLIDE').time, MG, 1e-9);
  near('the cut sits at the window minus the forced glide',
    r.cutAltitude, A - hMin, 1e-9);
  /* 2.2 s is dropmapsfn's initialCooldownS for this exact mechanic, adopted over
     the feel-tuned 2.0 it replaced. */
  ok('which is 84.6 m at the shipped 2.2 s floor',
    Math.abs(r.cutAltitude - 84.6) < 0.01, f(r.cutAltitude,1)+' m');
  near('re-open altitude is the configured 6 m', r.reopenAltitude, 6, 1e-9);
  near('freefall row time = drop at 60 m/s plus the re-opened 6 m',
    px(r.phases,'FREEFALL').time,
    (r.cutAltitude - 6)/F.vv + 6/G.vv, 1e-9);
  ok('re-open is folded in, not shown as a fourth phase', r.phases.length === 3);

  /* Constant across every distance, since the bottom is fixed. */
  let varied = 0;
  for (let d = 0; d <= S.maxReach(cfgD, H); d += 11) {
    const q = S.solveDescent(cfgD, H, d);
    if (Math.abs(q.cutAltitude - r.cutAltitude) > 1e-9) varied++;
    if (Math.abs(px(q.phases,'FREEFALL').time - px(r.phases,'FREEFALL').time) > 1e-9) varied++;
  }
  ok('cut altitude and freefall time are identical on every drop', varied === 0, String(varied));

  /* Holding the glider longer must push the cut lower, one for one. Stepped off
     the shipped floor rather than hardcoded, so tuning it does not break this. */
  const shorter = S.solveDescent({...cfgD, minGlideTime:MG - 0.5}, H, 300);
  const longer  = S.solveDescent({...cfgD, minGlideTime:MG + 0.5}, H, 300);
  ok('a longer forced glide cuts lower', longer.cutAltitude < r.cutAltitude,
    f(r.cutAltitude,1)+' -> '+f(longer.cutAltitude,1)+' m');
  ok('a shorter forced glide cuts higher', shorter.cutAltitude > r.cutAltitude);
  near('half a second of extra glide costs exactly glideVv/2 of altitude',
    r.cutAltitude - longer.cutAltitude, 0.5 * G.vv, 1e-9);
}

head('AIR TIME rises with distance, which is what a real race proved');
{
  /* GROUND MUST COST TIME. DIVE.vv was briefly set equal to FREEFALL.vv, on the
     theory that a skydive falls at terminal speed however you steer. That made
     steering free, so every distance inside dive reach took the same time and
     the solver bailed off the bus as early as it possibly could.

     A real drop settled it: on a 240 m offset the tool said jump 287 m early,
     the other player jumped later and landed 2 s sooner. Flying 139 m further
     cost real time, so the flat region was wrong. DIVE.vv must stay strictly
     below FREEFALL.vv, and the gap is what makes ground cost anything. */
  ok('the dive is strictly shallower than freefall, so steering costs time',
    D.vv < F.vv, f(D.vv,1)+' vs '+f(F.vv,1)+' m/s');

  const diveReach = S.maxReach(cfg, H);
  /* The only legitimately flat region is below the shortest descent the model
     can make: even the steepest dive carries FREEFALL.vh of drift. */
  const dMin = (hMin*rG + (A-hMin)*rF) + (H - A) * rF;
  let flat = 0, n = 0;
  for (let d = Math.ceil(dMin) + 2; d <= diveReach - 1; d += 4) {
    const a = S.solveDescent(cfg, H, d), b = S.solveDescent(cfg, H, d - 4);
    n++;
    if (Math.abs(a.time - b.time) < 1e-9) flat++;
  }
  ok(`air time strictly increases across all ${n} distances past the steepest dive`,
    flat === 0, flat + ' flat steps');
  /* Measured in game: diving as far as possible without ever pulling the glider
     early reaches about 720 m from an 830 m drop. */
  ok('max dive reach matches the 720 m measured in game',
    Math.abs(diveReach - 720) < 40, f(diveReach,0)+' m vs 720 m measured');

  /* Past dive reach it must rise, and never fall. */
  let backwards = 0, m = 0, prev = -Infinity;
  for (let d = Math.ceil(diveReach) + 1; d <= S.maxReach(cfgE, H) - 1; d += 4) {
    const t = S.solveDescent(cfgE, H, d).time;
    m++;
    if (t < prev - 1e-9) backwards++;
    prev = t;
  }
  ok(`air time never decreases across ${m} samples past dive reach`, backwards === 0,
    String(backwards));
  ok('and it genuinely rises once the glider is doing the work',
    S.solveDescent(cfgE, H, diveReach + 400).time > S.solveDescent(cfgE, H, diveReach).time + 5,
    f(S.solveDescent(cfgE,H,diveReach).time,1)+' s -> '
      + f(S.solveDescent(cfgE,H,diveReach+400).time,1)+' s');

  const near0 = S.solveDescent(cfgE, H, 0), far0 = S.solveDescent(cfgE, H, 600);
  /* Needing less ground means a steeper, faster descent. */
  ok('a short drop dives steeper than a long one', near0.diveVv > far0.diveVv,
    f(near0.diveVv,1)+' vs '+f(far0.diveVv,1)+' m/s');
  ok('the steepest dive is bounded by the freefall maximum',
    near0.diveVv <= F.vv + 1e-9, f(near0.diveVv,1));
  ok('the shallowest dive is the nominal dive speed', far0.diveVv >= D.vv - 1e-9,
    f(far0.diveVv,1));
  ok('a short drop lands sooner than a long one', near0.time < far0.time,
    f(near0.time,1)+' s vs '+f(far0.time,1)+' s');
}

head('OG MODE: same speeds, no cut, no freefall');
{
  /* OG cannot cut the glider, so it opens at the auto-deploy floor and carries
     you all the way in. Everything above the floor is identical to Battle
     Royale: same dive, same glide, same early pull. */
  const og  = { ...cfgE, canCut:false };
  const brD = S.solveDescent(cfgE, H, 0), ogD = S.solveDescent(og, H, 0);

  ok('OG drops the freefall phase entirely',
    !ogD.phases.some(p => p.mode === 'FREEFALL'), ogD.phases.map(p=>p.mode).join('>'));
  ok('Battle Royale keeps it', brD.phases.some(p => p.mode === 'FREEFALL'));
  ok('OG reports the cut as unavailable', ogD.cut === false);
  near('and has no cut altitude', ogD.cutAltitude, 0, 1e-9);
  near('and no re-open', ogD.reopenAltitude, 0, 1e-9);

  /* The whole 100 m window is glide, so it takes exactly A / GLIDE.vv. */
  near('the glider covers the whole auto-deploy window',
    px(ogD.phases,'GLIDE').altitude, A, 1e-9);
  near('taking A / glide descent rate', px(ogD.phases,'GLIDE').time, A/G.vv, 1e-9);

  /* Nothing above the floor changes. */
  near('the dive is untouched', px(ogD.phases,'DIVE').time, px(brD.phases,'DIVE').time, 1e-9);
  ok('so OG takes longer to land, because gliding beats freefall for time',
    ogD.time > brD.time, f(brD.time,1)+' s vs '+f(ogD.time,1)+' s');
  ok('but reaches further, because gliding covers more ground',
    S.maxReach(og, H) > S.maxReach(cfgE, H),
    f(S.maxReach(cfgE,H),0)+' m vs '+f(S.maxReach(og,H),0)+' m');

  /* minGlideTime is a floor on a cut that cannot happen, so it must not move
     anything in OG. */
  const ogSlow = S.solveDescent({ ...og, minGlideTime: 99 }, H, 0);
  near('minGlideTime is inert without a cut', ogSlow.time, ogD.time, 1e-9);

  /* The early pull still works the same way. */
  const far = S.solveDescent(og, H, S.maxReach(og, H) - 50);
  ok('a long OG drop still pulls early', far.earlyDeploy === true);
  ok('and still has no freefall', !far.phases.some(p => p.mode === 'FREEFALL'),
    far.phases.map(p=>p.mode).join('>'));

  /* Default is unchanged: omitting canCut must behave as Battle Royale. */
  const noFlag = S.solveDescent({ ...cfgE }, H, 0);
  ok('omitting canCut keeps the Battle Royale ending', noFlag.cut === true);
}

head('MEASURED IN GAME: every constant is answerable to these five numbers');
{
  /* Taken from an 830 m drop over flat ground. They over-determine the model,
     so all five must hold at once. If any fails, a constant has been changed on
     the strength of a web page instead of a stopwatch. */
  const early = {...cfg, allowEarlyDeploy:true};

  const straight = S.solveDescent(early, 830, 0);
  const toDeploy = (830 - A) / F.vv;
  near('straight down, 830 m to auto-deploy, measured 13 s', toDeploy, 13, 0.6);
  near('auto-deploy to the ground, measured about 4 s',
    straight.time - toDeploy, 4.0, 0.8);

  /* THE ~4 s READING CANNOT SETTLE THE GLIDER SINK RATE. Battle Royale cuts
     after the 2 s floor and freefalls the rest, so the stopwatch barely moves
     between a 5 m/s and a 7 m/s sink. That is why OG measuring 5.0 is not
     evidence about Battle Royale, and why Battle Royale keeps its own 7.0. */
  const sink = (vv) => {
    const c = {...cfg, modes:{...cfg.modes, GLIDE:{...G, vv, vh:(G.vh/G.vv)*vv}}};
    const s = S.solveDescent({...c, allowEarlyDeploy:true}, 830, 0);
    return s.time - toDeploy;
  };
  ok('a 5 and a 7 m/s glider are within half a second in Battle Royale',
    Math.abs(sink(5) - sink(7)) < 0.5,
    f(sink(5),2)+' s vs '+f(sink(7),2)+' s');

  near('max dive without ever pulling early, measured 720 m',
    S.maxReach(cfg, 830), 720, 40);
  near('max reach pulling the glider instantly, measured about 2500 m',
    S.maxReach(early, 830), 2500, 120);

  const rr = S.solveRoute({busStart:{x:0,y:0}, busEnd:{x:4000,y:0},
    target:{x:2000,y:240}, busAltitude:830, samples:8000});
  near('lead at a 240 m offset, measured about 71 m', 2000 - rr.jumpPos.x, 71, 15);

  /* The bus jump window is 24 s. That is a constraint on the ROUTE, not on the
     descent: at 100 m/s it means the jumpable path is about 2400 m long. It is
     recorded here because a drawn route much longer than that is not a route you
     could actually jump anywhere along. */
  ok('a 24 s jump window at the shipped bus speed spans a sane part of the map',
    24 * CONFIG.busSpeed > 2000 && 24 * CONFIG.busSpeed < 3200,
    f(24 * CONFIG.busSpeed,0)+' m of jumpable route, island is 3099 m across');
}

head('MEASURED IN GAME: OG, where the glider is finally visible');
{
  /* OG cannot cut, so the whole 100 m auto-deploy window is glided and the sink
     rate is exposed for the first time. Straight down, glider open the whole
     way, the window took about 20 s.

     THIS IS AN OG OVERRIDE, NOT A NEW SHARED CONSTANT. Battle Royale keeps the
     7.0 it was measured and raced at; OG carries 5.0 for itself, exactly as
     modes_ui declares it. The test builds the override the same way the page
     does, so if the two ever disagree this fails. */
  const GLIDE_OG = {...G, vh:15.0, vv:5.0};
  const og = {...cfg, modes:{...cfg.modes, GLIDE:GLIDE_OG},
              canCut:false, allowEarlyDeploy:true};
  const straightOG = S.solveDescent(og, 830, 0);
  const toDeployOG = (830 - A) / F.vv;
  near('the auto-deploy window is glided in the measured 20 s',
    straightOG.time - toDeployOG, 20, 1.2);
  near('which is the measured OG sink rate', A / GLIDE_OG.vv, 20, 1.2);
  ok('and the glider never cuts, so there is no freefall row',
    !straightOG.phases.some(p => p.mode === 'FREEFALL'));

  /* THE RATIO IS OG'S OWN, AND IT IS LOWER THAN BATTLE ROYALE'S.

     It used to be Battle Royale's 3.314 reapplied to the slower sink, which is
     the same cross-mode guess that shipped the wrong island scale and the wrong
     sink rate into OG before it. It read as landing 25-30 m short of the pin by
     the SAME amount on every drop, near or far.

     A constant miss can only come from a fixed-altitude phase, and OG has
     exactly one: it cannot cut, so the whole 100 m auto-deploy window is glide
     on every descent. 100 m of window turns 0.25-0.30 of ratio into 25-30 m of
     ground, which is the miss. 3.0 is the conservative end of that band, and it
     is round in the units the game stores: 1500 and 500 uu/s. */
  const rG = GLIDE_OG.vh / GLIDE_OG.vv;
  near('the OG glide ratio is 3.0, measured from a constant shortfall', rG, 3.0, 1e-9);
  ok('which is below Battle Royale\'s, so OG no longer borrows it',
    rG < G.vh / G.vv, f(rG,3)+' vs '+f(G.vh/G.vv,3));
  near('the ground it removes is the 25-30 m the drop was landing short',
    A * (G.vh/G.vv - rG), 27.5, 4);
  ok('and it errs long, so a wrong guess lands you on the roof, not the street',
    A * (G.vh/G.vv - rG) >= 25);
  near('Battle Royale keeps its own 7.0 m/s sink', G.vv, 7.0, 1e-9);
  near('and its 23.2 m/s glide', G.vh, 23.2, 1e-9);
  near('so max reach on an instant pull still matches the measured 2500 m',
    S.maxReach({...cfg, allowEarlyDeploy:true}, 830), 2500, 120);

  /* Ground height, from two independent readings that agree.
     Landing 25 m short against 17.5 m of modelled ground: 25/3.0 = 8.3 m
     missing, so the ground is 25.8 m.
     Reaching auto-deploy in 12.5 s: 830 - 100 - 12.5*56.2 = 27.5 m. */
  near('25 m short against 17.5 m of ground puts the real ground at 25 m',
    17.5 + 25/rG, 25, 1.5);
  near('and 12.5 s of freefall puts it at 27.5 m, agreeing within hand timing',
    830 - A - 12.5*F.vv, 27.5, 1);
  ok('the two agree closely enough to ship one number',
    Math.abs((17.5 + 25/rG) - (830 - A - 12.5*F.vv)) < 5,
    f(17.5 + 25/rG,1)+' m vs '+f(830 - A - 12.5*F.vv,1)+' m');
}

head('CROSS-CHECKED against an independent implementation');
{
  /* dropmapsfn ships a skydive velocity polar sampled at eleven pitch angles.
     Most of it disagrees with what was measured here and is not adopted: its
     shallow end implies a 1020 m max dive against the 720 m measured, its
     gravity integration puts a straight-down drop at 15.3 s against the 13 s on
     the stopwatch, and its glide ratio of 20/7 gives a 2371 m max reach against
     the ~2500 m measured.

     One row of it is worth keeping, because it is the only outside agreement
     FREEFALL.vh has ever had. That constant was assumed: no source publishes it,
     and it appears in the marginal-speed formula, so it moves the jump point. */
  near('FREEFALL matches their polar\'s 65 degree row, horizontally', F.vh, 8.9, 0.4);
  near('and vertically', F.vv, 55.4, 1.2);
  ok('so the one assumed constant in the model is independently corroborated',
    Math.abs(F.vh - 8.9) < 0.4 && Math.abs(F.vv - 55.4) < 1.2,
    f(F.vh,1)+'/'+f(F.vv,1)+' vs their 8.9/55.4');

  /* Their cut cooldown, adopted: same mechanic, better sourced than our feel. */
  near('the glide floor is their initialCooldownS', CONFIG.minGlideTime, 2.2, 1e-9);

  /* What is NOT adopted, each with the measurement it would break. */
  ok('their glide ratio 20/7 is rejected: it costs 130 m of measured max reach',
    Math.abs(G.vh/G.vv - 20/7) > 0.4, f(G.vh/G.vv,3)+' vs their '+f(20/7,3));
  ok('their skydive polar is rejected: its shallow end implies a 1020 m max dive',
    D.vh/D.vv < 0.95, f(D.vh/D.vv,3)+' vs their 0.98 near level');
}

head('MEASURED IN GAME: the jump lead on a real race');
{
  /* THE ONLY EMPIRICAL ANCHOR IN THE PROJECT.

     A real drop, two players on one bus. Perpendicular offset 240 m from an
     830 m drop. This tool said jump 287 m early; the other player jumped later
     and landed 2 s sooner. Reconstructing from the bus time saved puts the
     correct lead near 71 m and the marginal ground speed at 28.4 m/s.

     Independently, technik-consulting.eu's published rule of thumb is to jump
     the perpendicular offset divided by 3, which is 80 m here.

     Two unrelated sources agreeing inside 10 m is the strongest evidence
     available, so the lead is pinned between them. If this test fails, the tool
     has drifted back toward jumping too early, which is the single most
     persistent bug in this project. */
  const geom = {busStart:{x:0,y:0}, busEnd:{x:4000,y:0}, busAltitude:830, samples:8000};
  const r240 = S.solveRoute({...geom, target:{x:2000,y:240}});
  const lead240 = 2000 - r240.jumpPos.x;
  ok('a 240 m offset leads between the race (71 m) and the rule (80 m), give or take 25',
    lead240 > 50 && lead240 < 105, f(lead240,0)+' m');
  ok('and nowhere near the 287 m that lost the race', lead240 < 150, f(lead240,0)+' m');

  /* The rule of thumb is about the MARGINAL ground speed, not DIVE.vh. */
  const marginal = (F.vv*D.vh - F.vh*D.vv) / (F.vv - D.vv);
  near('marginal ground speed matches the race measurement', marginal, 28.4, 3);

  /* BUS SPEED AND DIVE ARE A MATCHED PAIR AND MUST MOVE TOGETHER.

     The race pins lead = offset * m / sqrt(busSpeed^2 - m^2), one equation in
     two unknowns, so busSpeed alone is not measured by it: bus 100 wants a
     marginal of 28.4, bus 75 wants 21.3, and both reproduce the race exactly.
     dropmapsfn ships 75 with a skydive polar at 17.7-18.1 horizontal, which is
     the other branch, self-consistently.

     This asserts the shipped pair still lands on the raced lead, so changing
     busSpeed without re-solving DIVE fails here instead of silently throwing the
     only empirical anchor away. tools/bus_fork.js does the re-solve. */
  const leadFormula = 240 * marginal / Math.sqrt(CONFIG.busSpeed**2 - marginal**2);
  near('busSpeed and DIVE are a matched pair that still reproduce the race',
    leadFormula, 71, 8);
  const divisor = Math.sqrt((CONFIG.busSpeed/marginal)**2 - 1);
  ok('which puts the divisor near the published 3, without matching it exactly',
    divisor > 2.9 && divisor < 3.6,
    f(divisor,2)+' from the measurement vs the published 3');

  /* Mid offsets should track the rule closely. */
  for (const Y of [200, 300, 400]) {
    const rr = S.solveRoute({...geom, target:{x:2000,y:Y}});
    const lead = 2000 - rr.jumpPos.x;
    ok(`Y=${Y}: within 45 m of the offset/3 rule`, Math.abs(lead - Y/3) < 45,
      f(lead,0)+' m vs the rule\'s '+f(Y/3,0)+' m');
  }
}

head('effective ground speed against the published band');
{
  /* technik-consulting.eu states 20 to 32 m/s toward the landing point.
     Offsets kept inside the auto-deploy-only reach, which is now the default. */
  const geom = {busStart:{x:0,y:0}, busEnd:{x:4000,y:0}, busAltitude:830, samples:4000};
  const speeds = [];
  for (const Y of [200,350,500,600]) {
    const r = S.solveRoute({...geom, target:{x:2000,y:Y}});
    speeds.push(r.airDistance / r.airTime);
  }
  const lo = Math.min(...speeds), hi = Math.max(...speeds);

  /* KNOWN, DELIBERATE DISAGREEMENT WITH THE SOURCE, PINNED SO IT STAYS VISIBLE.

     technik-consulting.eu gives two figures that do not describe the same
     quantity and cannot both be honoured:

       the BAND   "v_z, average speed towards the finish, 20 to 32 m/s"
       the RULE   "jump the perpendicular offset divided by 3"

     The rule is set by the MARGINAL ground speed, not the average, and it needs
     a marginal near 32 against a 100 m/s bus. Chasing the band instead, by
     setting DIVE.vh to 32, pushes the marginal to 58 and the lead to more than
     double the rule, which is what lost a real race by 2 s.

     So the rule and the measured race win, and the average comes out below the
     published band. That is a real conflict, not an oversight. The same page's
     gamma table is separately inconsistent with its own bus speed, so its
     numbers do not form one coherent model to begin with. */
  ok('average ground speed sits below the published 20-32 band, as expected',
    hi < 20, f(lo,1)+' to '+f(hi,1)+' m/s');
  ok('but the marginal speed, which is what the rule is about, is near 32',
    Math.abs((F.vv*D.vh - F.vh*D.vv)/(F.vv - D.vv) - 32) < 6,
    f((F.vv*D.vh - F.vh*D.vv)/(F.vv - D.vv),1)+' m/s');
  ok('average is still a sane fraction of the marginal, not collapsed',
    lo > 8, f(lo,1)+' m/s');

  /* Total air time for a mid drop should be plausible, not 40 s. */
  const r = S.solveRoute({...geom, target:{x:2000,y:600}});
  ok('air time for a 600 m offset drop is plausible', r.airTime > 15 && r.airTime < 35,
    f(r.airTime,1)+' s');
}

head('exit point is meaningfully BEFORE the closest approach');
{
  const geom = {busStart:{x:0,y:0}, busEnd:{x:4000,y:0}, busAltitude:830, samples:6000};
  for (const Y of [300, 500, 600]) {
    const r = S.solveRoute({...geom, target:{x:2000,y:Y}});
    const before = 2000 - r.jumpPos.x;
    ok(`Y=${Y}: jumps before drawing level with the target`, before > 0, f(before,0)+' m');
    /* The reference implementation settles around 0.25 of the offset in the
       glide regime, so anything above roughly 0.15 is the right territory.
       It used to be 0.72, which is what felt far too early in game. */
    ok(`Y=${Y}: the offset is substantial, not a token few metres`, before > Y*0.15,
      f(before,0)+' m is '+f(before/Y,2)+' of the offset');
  }
  /* THE PUBLISHED RULE OF THUMB, AND WHY THIS MODEL DELIBERATELY EXCEEDS IT.

     technik-consulting.eu says to jump the perpendicular offset divided by 3.
     That rule is not a measurement, it is the optimum of their own model, in
     which ground distance always costs time at one constant speed vz:

       T(u) = (X-u)/vb + sqrt(u^2 + Y^2)/vz   ->   u = Y / sqrt((vb/vz)^2 - 1)

     The vz in that formula is the MARGINAL ground speed, not DIVE.vh and not the
     average. Getting this wrong is what caused the whole too-early saga: DIVE.vh
     was set to 32 because the divisor works out to 3 for vz=32, but the model's
     marginal was then 58 and the lead more than doubled. */
  const divisor = (vb, vz) => Math.sqrt((vb/vz)**2 - 1);
  const marginalSpeed = (F.vv*D.vh - F.vh*D.vv) / (F.vv - D.vv);
  /* The MEASURED race gives a divisor of 3.4, the published rule says 3. They
     disagree by 12 percent and the measurement wins, but they are close enough
     that the rule remains a good sanity check on the order of magnitude. */
  near('the model divisor matches the measured race',
    divisor(CONFIG.busSpeed, marginalSpeed), divisor(CONFIG.busSpeed, 28.4), 0.15);
  ok('and stays within 15 percent of the published divide-by-3 rule',
    Math.abs(divisor(CONFIG.busSpeed, marginalSpeed) - 3) < 0.45,
    f(divisor(CONFIG.busSpeed,marginalSpeed),2)+' vs the rule\'s 3');
  ok('DIVE.vh on its own does NOT reproduce it, and must not be used for this',
    Math.abs(divisor(CONFIG.busSpeed, D.vh) - 3) > 0.5,
    'DIVE.vh gives '+f(divisor(CONFIG.busSpeed,D.vh),2)+', marginal gives '
      + f(divisor(CONFIG.busSpeed,marginalSpeed),2));

  /* TWO REGIMES, and the model behaves differently in each.

     Inside dive reach, steepening the dive trades fall speed for ground at a
     CONSTANT marginal rate, because both velocity components interpolate
     linearly along DIVE -> FREEFALL. That constant is what sets the lead, and it
     must stay finite: when it went unbounded (DIVE.vv equal to FREEFALL.vv) the
     tool bailed off the bus as early as it could and lost a real race by 2 s.
     Past dive reach the extra ground comes from gliding, which is slower still,
     so the rate drops again. */
  const marginal = (d) => {
    const a = S.solveDescent(cfgE, 830, d), b = S.solveDescent(cfgE, 830, d + 1);
    return (a && b) ? 1 / (b.time - a.time) : null;
  };
  const diveReach = S.maxReach(cfg, 830);
  const mid = (( (hMin*rG + (A-hMin)*rF) + (830-A)*rF ) + diveReach) / 2;
  ok('marginal ground speed inside dive reach is finite, not free',
    marginal(mid) < 60, f(marginal(mid),1)+' m/s');
  near('and matches the closed form used to pick DIVE.vh',
    marginal(mid), (F.vv*D.vh - F.vh*D.vv)/(F.vv - D.vv), 0.5);
  ok('past dive reach the glider takes over and ground gets more expensive',
    marginal(diveReach + 300) < marginal(mid),
    f(marginal(diveReach + 300),1)+' m/s vs '+f(marginal(mid),1)+' m/s');

  const leadAt = (Y) => {
    const r = S.solveRoute({...geom, target:{x:2000,y:Y}});
    return r.ok ? 2000 - r.jumpPos.x : null;
  };
  /* In the glide regime the lead must be proportional to the offset. Offsets
     well past dive reach are the ones that matter: they are the real drops. */
  const ratios = [600,700,800,900].map(Y => leadAt(Y)/Y);
  const spread = Math.max(...ratios) - Math.min(...ratios);
  ok('in the glide regime the lead is proportional to the offset', spread < 0.05,
    'lead/offset spans '+f(Math.min(...ratios),2)+' to '+f(Math.max(...ratios),2));

  /* THE REGRESSION THAT MATTERED. With DIVE.vv at 32 the dive reached 795 m, so
     nearly every real drop sat in the free-ground regime and the tool led by 430 m
     on a 600 m offset. The reference leads by 149 m there. */
  ok('a 600 m offset no longer leads by anything like 430 m',
    leadAt(600) < 200, f(leadAt(600),0)+' m');
  ok('and it lands in the same territory as the reference',
    Math.abs(leadAt(600) - 149) < 60, f(leadAt(600),0)+' m vs the reference\'s 149 m');

  /* The optimum is very flat, so none of this is worth much wall-clock time.
     Worth pinning: a large error in the jump point costs very little. */
  /* cfgE, not cfg: 100 m past the optimum runs past the no-early-pull reach,
     and an out-of-range probe would make this measure nothing. */
  const at = (u) => {
    const a = S.solveDescent(cfgE, 830, Math.hypot(u, 600));
    return a ? (2000 - u)/CONFIG.busSpeed + a.time : Infinity;
  };
  let best = Infinity, bestU = 0;
  for (let u = 0; u <= 900; u += 1) { const t = at(u); if (t < best) { best = t; bestU = u; } }
  /* A bigger lead means jumping EARLIER. The optimum is sharper than it used to
     be, because the dive no longer buys ground for free, but a 50 m error still
     costs about a tenth of a second, so do not present the jump point as exact. */
  ok('being 50 m early or late costs about a tenth of a second',
    at(bestU - 50) - best < 0.15 && at(bestU + 50) - best < 0.15,
    '+'+f(at(bestU+50)-best,3)+' s early / +'+f(at(bestU-50)-best,3)+' s late');
  ok('and the penalty is roughly symmetric, so neither side is a trap',
    Math.abs((at(bestU + 150) - best) - (at(bestU - 150) - best)) < 0.5,
    'early +'+f(at(bestU+150)-best,2)+' s vs late +'+f(at(bestU-150)-best,2)+' s');
}

head('totals stay consistent with the new phase');
for (const d of SPAN(5)) {
  const r = S.solveDescent(cfg, H, d);
  near(`d=${d}: altitudes sum to H`, r.phases.reduce((a,p)=>a+p.altitude,0), H, 1e-9);
  near(`d=${d}: times sum to total`, r.phases.reduce((a,p)=>a+p.time,0), r.time, 1e-9);
  near(`d=${d}: all three phase distances sum to d`,
    r.phases.reduce((a,p)=>a+p.distance,0), d, 1e-6);
  ok(`d=${d}: no phase has negative altitude`, r.phases.every(p=>p.altitude >= -1e-9));
}

head('PHASE 1 DIVE: always the whole altitude above the floor');
for (const d of SPAN(4)) {
  const r = S.solveDescent(cfg, H, d);
  near(`d=${d}: dive altitude is exactly H - 100`, px(r.phases,'DIVE').altitude, H - A, 1e-9);
  /* Duration is NOT fixed any more: the angle steepens when less ground is
     needed, so a shorter drop spends less time in the dive. */
  ok(`d=${d}: dive duration is between the steepest and shallowest angle`,
    px(r.phases,'DIVE').time >= (H-A)/F.vv - 1e-9 &&
    px(r.phases,'DIVE').time <= (H-A)/D.vv + 1e-9,
    f(px(r.phases,'DIVE').time,2)+'s in ['+f((H-A)/F.vv,2)+', '+f((H-A)/D.vv,2)+']');
}
{
  /* Dive duration GROWS with the ground it has to cover, because covering more
     means a shallower and therefore slower dive. This is the property a real
     race confirmed: flying further genuinely costs time. */
  const a = S.solveDescent(cfgE, H, 0), b = S.solveDescent(cfgE, H, REACH - 1);
  ok('dive duration grows with the ground it must cover',
    b.phases[0].time > a.phases[0].time + 1,
    f(a.phases[0].time,1)+'s -> '+f(b.phases[0].time,1)+'s');
  const long = S.solveDescent(cfgE, H, REACH + 500);
  ok('a drop past dive reach costs real time, in the glide not the dive',
    long.time > b.time + 5, f(b.time,1)+'s -> '+f(long.time,1)+'s');
}

head('PHASE 3 FREEFALL is terminal, below the floor only');
{
  for (const d of SPAN(4)) {
    const r = S.solveDescent(cfg, H, d);
    near(`d=${d}: glide + freefall == the deploy window`,
      px(r.phases,'GLIDE').altitude + px(r.phases,'FREEFALL').altitude, A, 1e-9);
    ok(`d=${d}: freefall never exceeds the window minus the glide floor`,
      px(r.phases,'FREEFALL').altitude <= A - hMin + 1e-9);
  }
  const atMax = S.solveDescent(cfg, H, S.maxReach(cfg, H));
  near('even at max reach the window glide is only the floor',
    px(atMax.phases,'GLIDE').altitude, hMin, 1e-6);
  near('...and the freefall is still there', px(atMax.phases,'FREEFALL').altitude, A - hMin, 1e-6);
  ok('...and a cut is still recorded', atMax.cut === true);

  /* Monotonicity still holds with the floor and the new horizontal. */
  let prev = Infinity, mono = true;
  for (let d = 0; d <= S.maxReach(cfg, H); d += 5) {
    const ff = px(S.solveDescent(cfg, H, d).phases,'FREEFALL').altitude;
    if (ff > prev + 1e-9) mono = false;
    prev = ff;
  }
  ok('freefall shrinks monotonically as distance grows', mono);
  let gp = -Infinity, gmono = true;
  for (let d = 0; d <= S.maxReach(cfg, H); d += 5) {
    const g = px(S.solveDescent(cfg, H, d).phases,'GLIDE').altitude;
    if (g < gp - 1e-9) gmono = false;
    gp = g;
  }
  ok('glide grows monotonically as distance grows', gmono);
}

head('EARLY PULL still extends range');
{
  /* Reach is the glide-covered altitude above the floor plus the fixed window
     contribution, since the window is now the same on every drop. */
  const dWindow = hMin*rG + (A-hMin)*rF;
  near('early-pull reach == (H-A)*rGlide + the fixed window',
    S.maxReach(cfgE, H), (H-A)*rG + dWindow, 1e-9);
  ok('early pull extends range', S.maxReach(cfgE,H) > S.maxReach(cfg,H)*2);
  const far = S.solveDescent(cfgE, H, 1200);
  ok('far target pulls early', far.earlyDeploy === true);
  ok('early pull opens above the floor', far.deployAltitude > A);
  ok('freefall survives the early pull', px(far.phases,'FREEFALL').time > 0);
  near('...at the same fixed altitude as every other drop',
    px(far.phases,'FREEFALL').altitude, A - hMin, 1e-9);
  near('far target altitudes sum to H', far.phases.reduce((a,p)=>a+p.altitude,0), H, 1e-9);
  near('far target distances sum to d', far.phases.reduce((a,p)=>a+p.distance,0), 1200, 1e-6);
  const maxE = S.solveDescent(cfgE, H, S.maxReach(cfgE,H));
  near('at absolute max reach the early glide takes everything above the floor',
    px(maxE.phases,'GLIDE_EARLY').altitude, H - A, 1e-6);
  near('...the window glide is still just the floor',
    px(maxE.phases,'GLIDE').altitude, hMin, 1e-6);
  near('...and the dive is gone', px(maxE.phases,'DIVE').altitude, 0, 1e-6);
}

head('BUS SPEED and the jump-timing correction');
{
  ok('bus speed default is the sourced 100 m/s', CONFIG.busSpeed === 100, String(CONFIG.busSpeed));

  const geom = { busStart:{x:0,y:0}, busEnd:{x:3000,y:0}, target:{x:1500,y:600},
                 busAltitude:830, samples:4000 };
  const slow = S.solveRoute({ ...geom, busSpeed:73.3 });
  const fast = S.solveRoute({ ...geom, busSpeed:100 });
  ok('both solve', slow.ok && fast.ok);
  ok('a faster bus moves the jump point LATER along the route',
    fast.jumpPos.x > slow.jumpPos.x,
    f(slow.jumpPos.x,0)+' m -> '+f(fast.jumpPos.x,0)+' m');
  ok('a faster bus lowers total time', fast.total < slow.total);

  /* Monotone in bus speed: the whole point of the correction. */
  let prevX = -Infinity, mono = true;
  for (const bs of [50,60,73.3,85,100,120,150,200]) {
    const r = S.solveRoute({ ...geom, busSpeed:bs, samples:2000 });
    if (!r.ok || r.jumpPos.x < prevX - 1) mono = false;
    prevX = r.ok ? r.jumpPos.x : prevX;
  }
  ok('jump point is monotone increasing in bus speed', mono);

  /* The optimum must be a true local minimum, not an artefact. */
  const cfgN = { modes:CONFIG.modes, autoDeployAltitude:A, minGlideTime:MG,
                 landingRedeployTime:0, allowEarlyDeploy:true };
  const t = (x) => { const air = S.solveDescent(cfgN, 830, Math.hypot(1500-x,600));
                     return air ? x/100 + air.time : Infinity; };
  const x0 = fast.jumpPos.x;
  ok('reported optimum beats a point 50 m earlier', t(x0) <= t(x0-50)+1e-9,
    f(t(x0),4)+' vs '+f(t(x0-50),4));
  ok('reported optimum beats a point 50 m later', t(x0) <= t(x0+50)+1e-9,
    f(t(x0),4)+' vs '+f(t(x0+50),4));
  ok('reported optimum beats jumping abeam of the target', t(x0) <= t(1500)+1e-9,
    f(t(x0),4)+' vs '+f(t(1500),4));
}

head('route solver end to end');
{
  const r = S.solveRoute({ busStart:{x:0,y:0}, busEnd:{x:3000,y:0},
    target:{x:1400,y:150}, busAltitude:830, samples:4000 });
  ok('feasible', r.ok, r.reason);
  near('total == busTime + airTime', r.total, r.busTime + r.airTime, 1e-9);
  ok('three phases surface through the route solver', r.air.phases.length === 3);
  ok('glide floor respected through the route solver',
    r.air.phases[1].time >= MG - 1e-9 || r.air.earlyDeploy);
  const far = S.solveRoute({ busStart:{x:0,y:0}, busEnd:{x:3000,y:0},
    target:{x:1500,y:9000}, busAltitude:830, samples:500 });
  ok('out of range reported with a shortfall', !far.ok && far.shortfall > 0);
}

head('elevation and slider range');
{
  const geom = { busStart:{x:0,y:0}, busEnd:{x:3000,y:0}, target:{x:1200,y:200},
                 busAltitude:830, samples:2000 };
  const hi = S.solveRoute({ ...geom, terrainElevation:300 });
  near('effectiveH = busAltitude - elevation', hi.effectiveH, 530, 1e-9);
  /* Tolerance is 1e-3, not 1e-9: the jump point comes from numerical refinement,
     and with the shorter dive reach this target sits within a micrometre of the
     dive/glide boundary, so a sliver of early glide rounds in and out. */
  near('dive tracks the elevated terrain', hi.air.phases[0].altitude, 530-A, 1e-3);
  const lo = S.solveRoute({ ...geom, busAltitude:330, target:{x:1000,y:120} });
  const up = S.solveRoute({ ...geom, busAltitude:1330, target:{x:1000,y:120} });
  ok('slider low end solves', lo.ok, lo.reason);
  ok('slider high end solves', up.ok, up.reason);
  ok('higher drop means more reach', up.reach > lo.reach);
}

head('WALL HEIGHT OFFSET');
{
  const W = CONFIG.wallHeight;
  ok('a wall is 3.84 m, matching NA Drops', Math.abs(W - 3.84) < 1e-9, String(W));
  near('zero walls is zero metres', S.wallsToMetres(0), 0, 1e-12);
  near('one wall up', S.wallsToMetres(1), W, 1e-12);
  near('three walls down', S.wallsToMetres(-3), -3*W, 1e-12);
  near('ten walls', S.wallsToMetres(10), 10*W, 1e-12);
  ok('clamped at the positive limit', S.wallsToMetres(999) === CONFIG.wallRange*W);
  ok('clamped at the negative limit', S.wallsToMetres(-999) === -CONFIG.wallRange*W);
  near('non-integers snap to whole walls', S.wallsToMetres(2.4), 2*W, 1e-12);
  near('undefined is treated as zero', S.wallsToMetres(undefined), 0, 1e-12);

  /* The offset must behave exactly like terrain elevation. */
  const geom = {busStart:{x:0,y:0}, busEnd:{x:4000,y:0}, target:{x:2000,y:400},
                busAltitude:830, busSpeed:CONFIG.busSpeed, momentumTime:0, samples:2000,
                modes:CONFIG.modes, autoDeployAltitude:A, minGlideTime:MG,
                landingRedeployAltitude:CONFIG.landingRedeployAltitude,
                landingRedeployTime:0, allowEarlyDeploy:CONFIG.allowEarlyDeploy};
  const flat = S.solveRoute({...geom, terrainElevation:0});
  const up   = S.solveRoute({...geom, terrainElevation:S.wallsToMetres(5)});
  const down = S.solveRoute({...geom, terrainElevation:S.wallsToMetres(-5)});
  ok('all three solve', flat.ok && up.ok && down.ok);
  near('five walls up raises the ground by 5 * 3.84',
    flat.effectiveH - up.effectiveH, 5*W, 1e-9);
  near('five walls down lowers it by the same',
    down.effectiveH - flat.effectiveH, 5*W, 1e-9);
  ok('raising the ground shortens reach', up.reach < flat.reach);
  ok('lowering the ground extends reach', down.reach > flat.reach);
  /* Raising the ground pulls in two opposite directions: there is less
     altitude to fall through, which lands you sooner, but also less altitude
     to convert into distance, which shrinks reach and forces a later jump.
     Which one wins depends on the geometry, so total time has NO universal
     direction and must not be asserted to have one. Only the drop height and
     the reach are monotone. */
  let prevH = Infinity, prevR = Infinity, monoH = true, monoR = true, allSolve = true;
  for (let w = -CONFIG.wallRange; w <= CONFIG.wallRange; w++){
    const r = S.solveRoute({...geom, terrainElevation:S.wallsToMetres(w)});
    if (!r.ok){ allSolve = false; break; }
    if (r.effectiveH > prevH + 1e-9) monoH = false;
    if (r.reach     > prevR + 1e-9) monoR = false;
    prevH = r.effectiveH; prevR = r.reach;
  }
  ok('every offset across the slider range still solves', allSolve);
  ok('effective drop falls monotonically as the ground is raised', monoH);
  ok('reach falls monotonically as the ground is raised', monoR);

  /* THE TIME DIRECTION IS NOT A LAW, it depends on the constants, and asserting
     one was wrong twice. Raising the ground removes altitude, which lands you
     sooner, AND removes reach, which makes you jump later. Which wins depends on
     the dive ratio. At the constants shipped today the first effect wins at
     every offset, so the landing is always sooner; at earlier constants the far
     end flipped. Only effective drop and reach are genuinely monotone, and those
     are asserted above. This records the current direction WITHOUT turning it
     into a rule, so nobody later "fixes" the other case into existence. */
  let sooner = 0, later = 0;
  for (const Y of [150, 400, 800, 1400, 2000]) {
    const g = {...geom, target:{x:2000, y:Y}};
    const a = S.solveRoute({...g, terrainElevation:0});
    const b = S.solveRoute({...g, terrainElevation:S.wallsToMetres(10)});
    if (!a.ok || !b.ok) continue;
    if (b.total < a.total) sooner++; else if (b.total > a.total) later++;
  }
  ok('raising the ground changes landing time in a consistent direction today',
    sooner === 0 || later === 0, sooner+' sooner, '+later+' later');
  ok('and every offset still solves off raised ground', sooner + later > 0);

  /* Combining a real POI elevation with a wall nudge must simply add. */
  const combined = S.solveRoute({...geom, terrainElevation: 21.7 + S.wallsToMetres(2)});
  near('POI elevation and wall offset add', combined.effectiveH, 830 - 21.7 - 2*W, 1e-9);
}

head('degenerate inputs rejected');
{
  ok('zero-length route',
    S.solveRoute({busStart:{x:0,y:0},busEnd:{x:0,y:0},target:{x:9,y:9},busAltitude:830}).reason
    === 'degenerate-route');
  ok('elevation at drop height',
    S.solveRoute({busStart:{x:0,y:0},busEnd:{x:3000,y:0},target:{x:9,y:9},
      busAltitude:830,terrainElevation:830}).reason === 'no-altitude');
}

console.log('\n' + '='.repeat(78));
console.log('  phases carry their colour through to the page');
console.log('='.repeat(78));
{
  /* The page draws each phase's leg on the map and the dot on its row straight
     from `phase.color`. The solver has no opinion about the value, it just has
     to pass it along. It did not, once: the phase objects were built with
     `label` but not `color`, so the flight path and every phase dot rendered
     unpainted while every number on the panel stayed correct. Nothing that
     compared times or text could see it. */
  const tinted = JSON.parse(JSON.stringify(S.CONFIG.modes));
  tinted.DIVE.color = '#ff6467';
  tinted.GLIDE.color = '#00c758';
  tinted.FREEFALL.color = '#f99c00';
  const want = { GLIDE_EARLY:'#00c758', DIVE:'#ff6467', GLIDE:'#00c758', FREEFALL:'#f99c00' };

  const cfg = { ...S.CONFIG, modes: tinted };
  /* A short drop is dive-then-glide, a long one pulls the glider instantly and
     adds GLIDE_EARLY, so between them every phase the page can draw is built. */
  for (const [what, d] of [['a plain drop', 600], ['an instant pull', 2400]]) {
    const phases = S.solveDescent(cfg, 830, d).phases;
    for (const p of phases)
      ok(what + ': ' + p.mode + ' carries its colour', p.color === want[p.mode],
         'got ' + p.color + ', want ' + want[p.mode]);
  }

  /* Through the route solver too, which builds its own cfg and has dropped
     fields on the way past before. */
  const air = S.solveRoute({ busStart:{x:0,y:0}, busEnd:{x:5000,y:0}, target:{x:2000,y:600},
    busAltitude:830, modes:tinted }).air;
  ok('solveRoute keeps the colours', air.phases.every(p => p.color === want[p.mode]));

  /* A mode overriding a speed brings its own colour with it, the way OG does. */
  const og = JSON.parse(JSON.stringify(tinted));
  og.GLIDE = { ...og.GLIDE, vh:15.0, vv:5.0, color:'#123456' };
  const ogPhases = S.solveDescent({ ...S.CONFIG, modes:og, canCut:false }, 830, 600).phases;
  ok("an overriding mode's colour is the one used",
     ogPhases.filter(p => p.mode.startsWith('GLIDE')).every(p => p.color === '#123456'));
}

console.log('\n' + '='.repeat(78));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(78));
process.exit(fail ? 1 : 0);
