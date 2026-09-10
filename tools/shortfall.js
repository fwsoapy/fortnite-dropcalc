/* Why an OG drop lands short when a Battle Royale drop does not.

   The last stretch of the flight pays for any terrain the solver did not know
   about, and the two modes end completely differently:

     Battle Royale  ends in FREEFALL, ratio 9.0/56.2 = 0.16
     OG             ends in GLIDE,    ratio 15.0/5.0  = 3.00

   So a metre of ground the solver did not model costs 0.16 m of reach in Battle
   Royale and 3.0 m in OG, about 19x worse. OG once assumed sea level, because no
   API publishes OG POI elevations and none had been measured; it now carries its
   own landing surface. The assumption is invisible in Battle Royale either way,
   and dominant in OG.

   OG's glider is its own: the page declares it in CONFIG.modes_ui, so it has to
   be applied here too. Running this against CONFIG.modes.GLIDE measures Battle
   Royale's glider and calls the answer OG. */
const { CONFIG, maxReach, solveDescent } = require('../solver.js');

const BUS_ALTITUDE = 830;                 // lives in the page CONFIG, not solver.js
const OG_GLIDE = { id:'GLIDE', label:'Glide', vh:15.0, vv:5.0 };
const cfgFor = (canCut) => Object.assign({}, CONFIG, {canCut},
  canCut ? {} : {modes: Object.assign({}, CONFIG.modes, {GLIDE: OG_GLIDE})});
const BR = cfgFor(true), OG = cfgFor(false);
const H = BUS_ALTITUDE;
const r = (m) => m.vh/m.vv;

console.log('the last phase sets how much a metre of ground costs');
console.log('  Battle Royale ends in FREEFALL, ratio ' + r(CONFIG.modes.FREEFALL).toFixed(3));
console.log('  OG ends in GLIDE,               ratio ' + r(OG_GLIDE).toFixed(3));

/* Follow the plan the tool gave, then let the ground arrive `e` metres early.
   Speeds are constant inside a phase, so horizontal distance is proportional to
   altitude lost and the truncated phase can be prorated. */
function landedShort(cfg, d, e){
  const plan = solveDescent(cfg, H, d);
  if (!plan) return null;
  let alt = 0, run = 0;
  const budget = H - e;
  for (const p of plan.phases){
    if (alt + p.altitude <= budget){ alt += p.altitude; run += p.distance; continue; }
    const frac = (budget - alt) / p.altitude;
    run += p.distance * frac;
    alt = budget;
    break;
  }
  return d - run;
}

console.log('\nhow far short you land on a 600 m drop, by how high the ground really is');
console.log('  ground     Battle Royale        OG');
for (const e of [10, 20, 30, 40, 50]){
  const br = landedShort(BR, 600, e), og = landedShort(OG, 600, e);
  console.log('  ' + (e + ' m').padEnd(11)
    + (br === null ? 'n/a' : br.toFixed(0) + ' m short').padEnd(21)
    + (og === null ? 'n/a' : og.toFixed(0) + ' m short'));
}

console.log('\nsame thing at maximum reach, as a cross-check');
for (const [name, cfg] of [['Battle Royale', BR], ['OG', OG]]){
  const per = maxReach(cfg, H) - maxReach(cfg, H - 1);
  console.log('  ' + name.padEnd(15) + per.toFixed(2) + ' m of reach per metre of ground');
}

console.log('\nthe wall offset slider is the existing lever for exactly this');
const perWall = CONFIG.wallHeight * r(OG_GLIDE);
console.log('  one wall  = ' + CONFIG.wallHeight + ' m of ground = '
  + perWall.toFixed(1) + ' m of OG reach');
console.log('  +' + CONFIG.wallRange + ' walls = '
  + (CONFIG.wallRange*CONFIG.wallHeight).toFixed(1) + ' m of ground = '
  + (CONFIG.wallRange*perWall).toFixed(0) + ' m of OG reach');
console.log('\nso a shortfall of S metres means the ground is about S/'
  + r(OG_GLIDE).toFixed(2) + ' m above sea level,');
console.log('which is ' + (1/perWall).toFixed(3) + ' walls per metre short.');
