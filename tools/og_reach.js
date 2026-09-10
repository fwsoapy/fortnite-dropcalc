/* WHERE AN OG DROP'S GROUND DISTANCE ACTUALLY COMES FROM, AND WHICH CONSTANT
   IS ON THE HOOK WHEN THE USER LANDS SHORT.

   OG cannot cut the glider, so the last 100 m of every OG descent is a forced
   glide. That window is credited with autoDeployAltitude * glide ratio metres of
   ground on every single drop, no matter how far the target is. On a mid-map
   drop that is more than half the total distance, which is why an error in the
   OG glide ratio shows up as landing short by the SAME amount on every drop.

   Battle Royale can never see this: it cuts after the 2 s floor and freefalls,
   so its window is worth about 79 m and the dive does nearly all the work.

   Run:  node tools/og_reach.js
   ========================================================================== */
const { CONFIG, maxReach, solveDescent, ratio } = require('../solver.js');

const BUS_ALTITUDE = 830;            // lives in the page CONFIG, not solver.js
const OG_GROUND = 32.7;              // OG landing surface, terrain 25 + a roof

/* The OG glider. Sink 5.0 measured (100 m window in ~20 s). Forward speed 15.0,
   which used to be 16.57 = Battle Royale's ratio reapplied to the slower sink,
   and read as landing 25-30 m short of the pin on every drop. */
const OG_GLIDE = { id:'GLIDE', label:'Glide', vh:15.0, vv:5.0 };
const OG_GLIDE_OLD = { id:'GLIDE', label:'Glide', vh:16.57, vv:5.0 };

const ogCfg = (glide) => Object.assign({}, CONFIG, {
  canCut: false,
  modes: Object.assign({}, CONFIG.modes, { GLIDE: glide || OG_GLIDE })
});
const brCfg = Object.assign({}, CONFIG, { canCut: true });

const H_OG = BUS_ALTITUDE - OG_GROUND;
const rG = ratio(OG_GLIDE);
const A = CONFIG.autoDeployAltitude;

console.log('OG descent budget: bus ' + BUS_ALTITUDE + ' m, landing surface '
  + OG_GROUND + ' m, so H = ' + H_OG.toFixed(1) + ' m');
console.log('  the forced glide window is ' + A + ' m of altitude at ratio '
  + rG.toFixed(3) + ' = ' + (A * rG).toFixed(0) + ' m of ground, on every drop');
console.log('  Battle Royale window, for contrast: '
  + (maxReach(brCfg, BUS_ALTITUDE) - (BUS_ALTITUDE - A) * ratio(CONFIG.modes.DIVE)).toFixed(0)
  + ' m of ground');

console.log('\nhow much of the ground the FORCED GLIDE is asked to cover');
console.log('  drop      dive covers    glide covers   glide share');
for (const d of [300, 450, 600, 750, 900]) {
  const p = solveDescent(ogCfg(), H_OG, d);
  if (!p) { console.log('  ' + (d + ' m').padEnd(10) + 'out of range'); continue; }
  const dive = p.phases.filter(x => x.mode === 'DIVE')
    .reduce((s, x) => s + x.distance, 0);
  const glide = p.phases.filter(x => x.mode !== 'DIVE')
    .reduce((s, x) => s + x.distance, 0);
  console.log('  ' + (d + ' m').padEnd(10)
    + (dive.toFixed(0) + ' m').padEnd(15)
    + (glide.toFixed(0) + ' m').padEnd(15)
    + (100 * glide / d).toFixed(0) + '%');
}

/* A wrong glide ratio costs (A * delta) metres on every drop that is not in the
   early-pull regime, because the window is a fixed altitude. A wrong dive ratio
   costs nothing at all until the target is past dive reach, since a dive with
   ground to spare is simply flown steeper. That is how a reported miss tells
   you which one is wrong: a constant miss is the glide, a miss that grows with
   distance is the dive. */
console.log('\nwhat a reported shortfall implies for the OG glide ratio');
console.log('  short by   ratio      vh at 5.0 m/s sink   also equals');
for (const miss of [10, 20, 30, 40, 50]) {
  const r2 = rG - miss / A;
  console.log('  ' + (miss + ' m').padEnd(11)
    + r2.toFixed(3).padEnd(11)
    + (r2 * OG_GLIDE.vv).toFixed(2).padEnd(21)
    + (miss / (CONFIG.wallHeight * rG)).toFixed(1) + ' walls of slider');
}

console.log('\nsanity: what each candidate ratio does to reach and to a 600 m drop');
console.log('  ratio    max reach    dive-only reach   still solves 600 m');
for (const r2 of [3.314, 3.2, 3.1, 3.0, 2.9, 2.8]) {
  const cfg = ogCfg({ id:'GLIDE', label:'Glide', vh: r2 * 5.0, vv: 5.0 });
  const diveOnly = (H_OG - A) * ratio(CONFIG.modes.DIVE) + A * r2;
  console.log('  ' + r2.toFixed(3).padEnd(9)
    + (maxReach(cfg, H_OG).toFixed(0) + ' m').padEnd(13)
    + (diveOnly.toFixed(0) + ' m').padEnd(18)
    + (solveDescent(cfg, H_OG, 600) ? 'yes' : 'no'));
}

/* WHERE THE FIX SHOWS UP ON THE MAP, which is not the jump time. On a drop that
   is not near the reach limit the jump call barely moves, because the window's
   TIME did not change. What moves is the point the glider opens: the plan used
   to hand the window 331 m and hold the dive back to suit, so you arrived at the
   100 m mark 31 m further out than the glider could actually cover. */
console.log('\nwhere the glider opens, along the ground from the exit');
console.log('  drop      old       new       moves');
for (const d of [350, 500, 700, 850]) {
  const a = solveDescent(ogCfg(OG_GLIDE_OLD), H_OG, d);
  const b = solveDescent(ogCfg(), H_OG, d);
  if (!a || !b) continue;
  console.log('  ' + (d + ' m').padEnd(10)
    + (a.deployDistance.toFixed(0) + ' m').padEnd(10)
    + (b.deployDistance.toFixed(0) + ' m').padEnd(10)
    + '+' + (b.deployDistance - a.deployDistance).toFixed(0) + ' m toward the target');
}

/* Raising the ground instead is the other way to take reach away, and it is the
   lever that has already been used twice. It is now pinned: the user timed a
   straight-down OG drop to auto-deploy at about 12.5 s, which fixes H. */
console.log('\nthe ground lever is closed: H is pinned by the 12.5 s straight-down');
for (const g of [32.7, 40, 50, 60]) {
  const t = (BUS_ALTITUDE - g - A) / CONFIG.modes.FREEFALL.vv;
  console.log('  ground ' + (g + ' m').padEnd(8) + '-> straight down to auto-deploy '
    + t.toFixed(2) + ' s   (measured 12.5 s)');
}
