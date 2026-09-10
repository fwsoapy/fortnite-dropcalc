/* THE BUS SPEED FORK, AND WHY THE RACE DOES NOT SETTLE IT.

   The one empirical anchor in the project is a real race: a 240 m perpendicular
   offset, correct lead about 71 m. That fixes

     lead = offset * m / sqrt(busSpeed^2 - m^2)

   which is ONE equation in TWO unknowns. Every candidate bus speed has a
   marginal ground speed that reproduces the race exactly, and the marginal plus
   the measured dive ratio then solve DIVE uniquely. So the race constrains the
   PAIR and says nothing about either number on its own.

   That matters because dropmapsfn ships busSpeed 75 and a skydive velocity polar
   whose horizontal speed sits at 17.7-18.1 m/s. Those two are the same branch of
   this fork, self-consistently. Ours needs a dive horizontal of 20.4, which is
   above the 18.7 maximum their polar allows. Two coherent models, no measurement
   between them.

   Run:  node tools/bus_fork.js
   ========================================================================== */
const { CONFIG, ratio } = require('../solver.js');

const OFFSET = 240, LEAD = 71;                 // the race, as flown
const rD = ratio(CONFIG.modes.DIVE);           // 0.879, from the 720 m max dive
const F = CONFIG.modes.FREEFALL;               // 9.0 / 56.2, from the 13 s drop
const THEIR_POLAR_VH = [17.7, 18.1];           // dropmapsfn's flat section

const leadOf = (off, m, bus) => off * m / Math.sqrt(bus * bus - m * m);

/* Marginal ground speed that reproduces the raced lead at this bus speed. */
function marginalFor(bus) {
  let lo = 1, hi = bus - 1e-9;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (leadOf(OFFSET, mid, bus) < LEAD) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/* DIVE from that marginal, holding the measured ratio.
     m = D.vh - (F.vh - D.vh)/(F.vv - D.vv) * D.vv,  D.vh = rD * D.vv */
function diveFor(m) {
  let lo = 1, hi = F.vv - 1e-9;
  for (let i = 0; i < 200; i++) {
    const v = (lo + hi) / 2, h = rD * v;
    if (h - (F.vh - h) / (F.vv - v) * v < m) lo = v; else hi = v;
  }
  const vv = (lo + hi) / 2;
  return { vh: rD * vv, vv };
}

console.log('every one of these reproduces the raced ' + LEAD + ' m lead at a '
  + OFFSET + ' m offset');
console.log('  bus      marginal   implied DIVE        check');
for (const bus of [120, 110, 100, 90, 80, 75, 70]) {
  const m = marginalFor(bus), d = diveFor(m);
  const fits = d.vh >= THEIR_POLAR_VH[0] - 0.6 && d.vh <= THEIR_POLAR_VH[1] + 0.6;
  const shipped = Math.abs(bus - CONFIG.busSpeed) < 1e-9;
  console.log('  ' + String(bus).padEnd(9) + m.toFixed(1).padEnd(11)
    + (d.vh.toFixed(2) + ' / ' + d.vv.toFixed(2)).padEnd(20)
    + (shipped ? 'SHIPPED' : '') + (fits ? '  matches their polar' : ''));
}

/* Sanity: the shipped pair must still land on the race and on the dive reach. */
const m0 = marginalFor(CONFIG.busSpeed), d0 = diveFor(m0);
console.log('\nshipped pair checks out:');
console.log('  lead at ' + OFFSET + ' m offset   '
  + leadOf(OFFSET, m0, CONFIG.busSpeed).toFixed(1) + ' m   (raced ' + LEAD + ')');
console.log('  DIVE solved             ' + d0.vh.toFixed(2) + ' / ' + d0.vv.toFixed(2)
  + '   (shipped ' + CONFIG.modes.DIVE.vh + ' / ' + CONFIG.modes.DIVE.vv + ')');
console.log('  dive ratio held         ' + (d0.vh / d0.vv).toFixed(3)
  + '   (measured ' + rD.toFixed(3) + ')');

console.log('\nto settle it: time the bus between two POIs a known distance apart.');
console.log('whoever changes busSpeed must re-solve DIVE in the same commit,');
console.log('or the race anchor is silently thrown away.');
