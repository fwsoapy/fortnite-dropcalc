/* ==========================================================================
   DROP SOLVER v2 - fixed three-phase descent. Pure functions, no DOM.

   The descent is NOT a free mix of modes. It is a fixed sequence:

     1. DIVE      bus exit down to autoDeployAltitude above the landing
                  terrain. Fixed altitude budget, fixed duration. This is
                  where the horizontal distance gets covered.
     2. GLIDE     glider auto-deploys at autoDeployAltitude. Covers whatever
                  horizontal distance the dive did not.
     3. FREEFALL  cut the glider, drop straight down to bleed the remaining
                  altitude fast. Only possible below autoDeployAltitude, only
                  after auto-deploy has happened.

   Cutting is a terminal maneuver in the final autoDeployAltitude metres. It
   trades leftover glide time for a faster drop once the horizontal distance
   is already covered. There is no cutting above autoDeployAltitude and no
   mid-flight optimisation.

   ASSUMPTION: players redeploy briefly just before touchdown to avoid fall
   damage. That is real, but it is not shown as a separate phase. Its cost is
   folded into the FREEFALL time via CONFIG.landingRedeployTime, which
   defaults to 0 because no source publishes a figure for it.
   ========================================================================== */

'use strict';

const EPS = 1e-9;

/* --------------------------------------------------------------------------
   CONFIG - every constant lives here.

   Mode speeds are (horizontal, vertical) in m/s. Sourcing carried over from
   v1; see the notes in drop-solver.html for the full provenance table.

   Note which figures map to which phase. The steerable skydive that covers
   ground is DIVE and uses the 14.5 / 32 pair (32 m/s is the one number the
   repo and multiple web sources agree on). The terminal straight-down drop
   after cutting is FREEFALL and uses 0 / 60 ("maximum vertical descent
   without parachute", technik-consulting.eu).
   -------------------------------------------------------------------------- */
const CONFIG = {
  modes: {
    /* THESE SPEEDS ARE MEASURED IN GAME, NOT SOURCED FROM THE WEB.

       Five measurements were taken from an 830 m drop and every constant below
       is solved from them. They over-determine the model, and all five land
       inside measurement error at once, which no web-sourced set ever did.

         straight down, 830 m to auto-deploy .... 13 s     -> FREEFALL.vv 56.2
         auto-deploy to the ground .............. ~4 s     -> confirms GLIDE.vv 7
                                                              and minGlideTime 2.0
         max dive, never pulling early .......... ~720 m   -> dive ratio 0.878
         max reach pulling instantly ............ ~2500 m  -> glide ratio 3.32
         race: 240 m offset, correct lead ....... ~71 m    -> marginal 28.4 m/s

       The last one is the constraint that fixes the jump timing. What sets the
       jump point is the MARGINAL ground speed, how much extra time one more
       metre of ground costs:

         m = (FREEFALL.vv*DIVE.vh - FREEFALL.vh*DIVE.vv) / (FREEFALL.vv - DIVE.vv)
         lead = offset * m / sqrt(busSpeed^2 - m^2)

       Dive ratio plus that marginal solve DIVE uniquely: 20.4 / 23.2. The glide
       ratio then gives GLIDE.vh 23.2 against the unchanged GLIDE.vv 7.

       As a cross-check, technik-consulting.eu's published rule of thumb (jump
       the offset divided by 3, so 80 m here) sits 9 m from the measured 71 m.

       WHAT THE WEB GOT WRONG. technik lists "glide 32" as a speed toward the
       target and I took it literally, which gives m = 58.3 and a lead of 172 m,
       more than double their own rule of thumb and far outside the measured
       race. Their 32 is a peak, not something you hold across a descent, and
       their 60 m/s straight-down figure is 7% fast against the stopwatch. */
    DIVE:     { id:'DIVE',     label:'Dive',     vh:20.4, vv:23.2 },
    GLIDE:    { id:'GLIDE',    label:'Glide',    vh:23.2, vv: 7.0 },
    /* DIVE.vv 32 MUST STAY BELOW FREEFALL.vv, OR THE MODEL BREAKS.

       It was briefly 60, equal to FREEFALL.vv, on the theory that a skydive
       falls at terminal speed however you steer. That makes steering FREE: every
       distance inside dive reach takes exactly the same time, so the optimiser
       bails off the bus as early as it can and the tool told the user to jump
       287 m early on a 240 m offset. The race above disproves it outright, since
       flying 139 m further cost the user real time.

       Keep DIVE.vv strictly below FREEFALL.vv. The gap between them is what
       makes ground cost time at all.

       GLIDE.vv 7.0 is the reference repo's v_glide_v and is unsourced. */

    /* FREEFALL horizontal is NOT zero. technik-consulting.eu: "In the free
       fall phase, both the fall speed and the horizontal speed (= distance
       flight) change with your angle to the horizon." No source publishes the
       number, so 9.0 was assumed.

       CORROBORATED, and it is the only constant here that an outside model
       agrees with. dropmapsfn ships a velocity polar sampled at eleven pitch
       angles, and its 65 degree row is 8.9 horizontal against 55.4 vertical.
       Ours is 9.0 against 56.2, arrived at from a completely different
       direction. Two independent implementations landing on the same point of
       the curve is as close to a source as this number has ever had. */
    FREEFALL: { id:'FREEFALL', label:'Freefall', vh: 9.0, vv:56.2 }
  },
  autoDeployAltitude: 100,   // hardcoded, not user editable
  /* 100 m/s. technik-consulting.eu: "The bus in Fortnite is very fast with
     100 m / s or 360 km / h". The reference repo used 1100/15 = 73.3 with no
     stated source. Under-stating bus speed makes riding look expensive and
     drags the optimal jump point earlier, which is exactly the reported
     symptom, so this is corrected to the sourced figure.

     THIS IS THE ONE REAL FORK LEFT IN THE MODEL, AND THE RACE DOES NOT SETTLE
     IT. The measured 71 m lead at a 240 m offset pins the PAIR (busSpeed,
     marginal ground speed), not either alone, because

       lead = offset * m / sqrt(busSpeed^2 - m^2)

     has one equation and two unknowns. Holding the measured dive ratio 0.879
     and FREEFALL, each candidate bus speed solves DIVE and reproduces the race
     exactly:

       bus 100  ->  marginal 28.4  ->  DIVE 20.38 / 23.18   (shipped)
       bus  80  ->  marginal 22.7  ->  DIVE 17.77 / 20.21
       bus  75  ->  marginal 21.3  ->  DIVE 17.04 / 19.38

     dropmapsfn ships busSpeed 75 AND a skydive polar whose horizontal speed sits
     at 17.7-18.1, which is the 75-80 branch, self-consistently. Our 100 needs a
     dive horizontal of 20.4, above the 18.7 maximum their model allows. So the
     two models are each internally coherent and disagree about which branch is
     real, with no measurement between them.

     NOT FLIPPED, because a coin flip here moves every jump time on screen and
     the current branch is the one that has been played. `tools/bus_fork.js`
     regenerates the table. To settle it: time the bus across a known distance,
     or note the clock at which it crosses two POIs a measured distance apart.
     Whoever changes it must re-solve DIVE in the same commit. */
  busSpeed: 100,
  /* Hard floor on the GLIDE phase: you cannot cut the instant the glider
     opens. No Epic figure exists (the nearest published number is a 0.5 s
     redeploy delay on the Chapter 4 Aerialist augment, a different mechanic).
     It came from play: 1.5 s cut too early and consistently overshot the target
     forward, and 2.0, the top of the reported 1.5-2 s range, fixed it.

     Now 2.2, which is dropmapsfn's `initialCooldownS` for the same mechanic: the
     cooldown after the glider deploys before it can be cut. An independent
     implementation's figure beats a feel-tuned one, and it continues the
     direction play already pushed this in. Moves the cut from 86 m to 84.6 m,
     which is worth about 4 m of reach. Inert in any mode that cannot cut. */
  minGlideTime: 2.2,
  /* Re-open the glider this far above the ground so the landing is survivable.
     NA Drops labels this marker "Re-Open at ~6m" in its own trajectory
     rendering, which is the only published figure for it anywhere. Its time is
     folded into the FREEFALL phase rather than shown as a fourth row. */
  landingRedeployAltitude: 6,
  /* WALL HEIGHT.
     A build-mode wall is the unit players actually judge height in, so terrain
     error is far easier to correct in walls than in metres. NA Drops uses
     exactly this, converting its offset with landingHeightOffsetMeters =
     3.84 * walls, which is where the figure comes from. Positive walls raise
     the ground at the landing spot, which lowers the effective drop and
     shortens reach. */
  wallHeight: 3.84,
  wallRange: 10,      // slider limit, plus and minus
  landingRedeployTime: 0,    // extra fixed cost, assumed 0
  momentumTime: 0,
  samples: 4000,

  /* EARLY DEPLOY
     You can pull the glider straight out of the bus rather than waiting for
     the 100 m auto-deploy. Horizontal speed while gliding is close to
     horizontal speed while diving, but the glider descends far slower, so an
     early pull buys a lot of range: glide out, then dive down once you are
     close enough.

     ON, but only used when it is actually needed. The solver always prefers a
     plain dive to the 100 m auto-deploy, because that is faster, and only
     reaches for an early pull once the target is beyond dive range. So short
     and mid drops read exactly as before (dive, auto-deploy, brief glide, cut)
     while long ones become reachable instead of reporting out of range.

     Turning this off caps reach at about 658 m from an 830 m drop, which
     wrongly rejects plenty of real drops. */
  allowEarlyDeploy: true
};

const ratio = (m) => (m.vv > EPS ? m.vh / m.vv : 0);

/* Fortnite walls to metres of terrain offset. Clamped to the slider range so a
   stray value cannot silently push the landing ground somewhere absurd. */
function wallsToMetres(walls, cfg) {
  const c = cfg || CONFIG;
  const lim = c.wallRange !== undefined ? c.wallRange : CONFIG.wallRange;
  const n = Math.max(-lim, Math.min(lim, Math.round(walls || 0)));
  return n * (c.wallHeight !== undefined ? c.wallHeight : CONFIG.wallHeight);
}

/* --------------------------------------------------------------------------
   DESCENT - solve the three phases for an altitude budget H and a horizontal
   distance d.

   Why "dive covers as much as it can" is optimal, not a heuristic: the dive
   altitude budget (H - A) and therefore the dive duration are fixed no matter
   how much ground it covers. What is left over must be covered by glide, at
   1/vvGlide seconds per metre of altitude, and any altitude the glide does
   not need is spent in freefall at the cheaper 1/vvFreefall. Since glide
   descends slower than freefall, total time is strictly decreasing in dive
   distance, so maximising it is optimal.
   -------------------------------------------------------------------------- */
function solveDescent(cfg, H, d) {
  if (H <= EPS) return null;

  const { DIVE, GLIDE, FREEFALL } = cfg.modes;
  const A  = Math.min(cfg.autoDeployAltitude, H);   // auto-deploy floor
  const hAbove = H - A;                             // altitude above the floor
  const rD = ratio(DIVE), rG = ratio(GLIDE), rF = ratio(FREEFALL);

  /* Hard floor on glide: you cannot cut the instant the glider opens. */
  const hGlideMin = Math.min((cfg.minGlideTime || 0) * GLIDE.vv, A);

  const reach = maxReach(cfg, H);
  if (d > reach + 1e-6) return null;                // cannot get there

  /* THE BOTTOM OF THE DESCENT, WHICH DEPENDS ON THE MODE.

     Modern Battle Royale (canCut true): the glider opens at A, you hold it for
     the minimum time you are forced to, then cut and freefall the rest of the
     way, re-opening at the last moment so the landing is survivable. There is
     never a reason to glide longer than the floor, because gliding is the
     slowest way down and freefall still carries horizontal speed.

       hGlideLate = hGlideMin      hFree = A - hGlideMin

     OG (canCut false): the glider cannot be cut, so it opens at A and takes you
     all the way in. The whole window is glide, there is no freefall phase and
     no re-open, and minGlideTime stops meaning anything because you are gliding
     far longer than any floor anyway.

       hGlideLate = A              hFree = 0

     Either way the window contributes a constant distance and duration to every
     drop, and all the variation lives above it. */
  const canCut = cfg.canCut !== false;
  const hGlideLate = canCut ? hGlideMin : A;
  const hFree = canCut ? A - hGlideMin : 0;
  /* The last few metres are back under canopy so the landing is survivable.
     This is part of the FREEFALL row, not a fourth phase. */
  const hReopen = canCut ? Math.min(cfg.landingRedeployAltitude || 0, hFree) : 0;
  const hDrop = hFree - hReopen;                    // true freefall altitude
  const dWindow = hGlideLate * rG + hDrop * rF + hReopen * rG;
  const reachDive = hAbove * rD;

  /* THE DIVE ANGLE IS CONTINUOUS, NOT FIXED.

     technik-consulting.eu: "In the free fall phase, both the fall speed and
     the horizontal speed (= distance flight) change with your angle to the
     horizon", quoting 12 / 32 / 60 m/s of descent across that range.

     Treating the dive as one fixed (14.5, 32) pair made air time go FLAT for
     any target inside dive reach, because the surplus was simply steered off
     for free. That produced a plateau of equal-time answers and a hard jump in
     the optimum at the regime edge. Modelling the angle properly: when you
     need less ground than the shallowest dive would cover, you point steeper
     and descend faster, so needing less distance genuinely costs less time.

     DIVE.vh / DIVE.vv define the SHALLOWEST sustainable dive, the one that
     covers the most ground. FREEFALL.vv (60, sourced as the maximum vertical
     speed) is the steepest. Between them the descent rate scales with how
     much of the shallow dive's reach you actually need. */
  const dAbove  = d - dWindow;                       // ground the upper leg must cover
  const rReq    = hAbove > EPS ? Math.max(0, dAbove) / hAbove : 0;

  let hDive, hGlideEarly, vvDive;

  if (rReq <= rD + 1e-12) {
    /* Steepen the dive to exactly the angle that still reaches.

       The steepening runs along the segment from DIVE to FREEFALL, so BOTH
       components move together and the steepest dive is FREEFALL itself.

       It used to interpolate the vertical speed alone, from DIVE.vv up to 60,
       while letting the horizontal be whatever the distance required. That let
       the dive reach 60 m/s vertical carrying about 0.9 m/s horizontal, while
       the FREEFALL mode says 60 m/s vertical carries 9 m/s. Same physical
       state, two answers, and the wrong one made the first hundred metres of
       ground almost free: marginal ground speed came out near 107 m/s, above
       the bus's own 100 m/s. The optimiser then bailed off the bus early for
       every close target, giving a jump lead of 278 m for a target only 100 m
       off the route, and a lead that barely changed with the offset at all.
       Interpolating the pair fixes the scaling: lead now grows in proportion
       to the offset, which is what the geometry requires. */
    hDive = hAbove; hGlideEarly = 0;
    const dvh = FREEFALL.vh - DIVE.vh, dvv = FREEFALL.vv - DIVE.vv;
    const den = dvh - rReq * dvv;
    /* s = 0 is the shallowest dive, s = 1 is freefall. Below the freefall ratio
       the target is nearer than the steepest possible dive, so clamp: you can
       always bleed off surplus ground, you cannot descend faster than 60. */
    const s = Math.abs(den) > EPS
      ? Math.min(1, Math.max(0, (rReq * DIVE.vv - DIVE.vh) / den))
      : 0;
    vvDive = DIVE.vv + dvv * s;
  } else {
    /* Beyond the shallowest dive, so pull the glider early and trade dive
       altitude for glide altitude at rG - rD metres per metre. */
    vvDive = DIVE.vv;
    const gain = rG - rD;
    hGlideEarly = gain > EPS ? Math.min((dAbove - reachDive) / gain, hAbove) : 0;
    hDive = hAbove - hGlideEarly;
  }

  const hGlide = hGlideEarly + hGlideLate;
  const tDive  = vvDive > EPS ? hDive / vvDive : 0;
  const tGlide = GLIDE.vv > EPS ? hGlide / GLIDE.vv : 0;
  const tGlideEarly = GLIDE.vv > EPS ? hGlideEarly / GLIDE.vv : 0;
  const tGlideLate  = GLIDE.vv > EPS ? hGlideLate  / GLIDE.vv : 0;
  /* FREEFALL row = the true drop plus the short re-opened glide at the bottom. */
  const tFree  = (FREEFALL.vv > EPS ? hDrop / FREEFALL.vv : 0)
               + (GLIDE.vv > EPS ? hReopen / GLIDE.vv : 0)
               + (hFree > 1e-6 ? cfg.landingRedeployTime : 0);

  /* FLIGHT ORDER.

     The altitude split above is order independent, so the maths does not care
     which phase comes first. The presentation does. When the glider is pulled
     early the sequence actually flown is: pull off the bus, glide, cut and
     dive, auto-deploy at A, hold the minimum, cut, freefall. Emitting that as
     dive-then-glide contradicted the on-screen instruction, so both the phase
     rows and the ground distances now come out in flown order. */
  const glideFirst = hGlideEarly > 1e-6;

  let rem = d;
  const take = (cap) => { const v = Math.max(0, Math.min(cap, rem)); rem -= v; return v; };
  const diveCap = hDive * (vvDive > EPS ? (rReq <= rD + 1e-12 ? rReq : rD) : 0);
  let dGlideEarly = 0, dDive = 0, dGlideLate = 0;
  if (glideFirst) {
    dGlideEarly = take(hGlideEarly * rG);
    dDive       = take(diveCap);
    dGlideLate  = take(hGlideLate * rG);
  } else {
    dDive       = take(diveCap);
    dGlideLate  = take(hGlideLate * rG);
  }
  const dFree = take(hDrop * rF + hReopen * rG);

  /* TWO SEPARATE GLIDES when the glider is pulled instantly. The flown
     sequence is: pull off the bus and glide, drop back into a dive without
     cutting, then the 100 m auto-deploy glide, then the freefall. Merging
     those two glides into one row hid the fact that there are two of them, so
     they are kept distinct: GLIDE_EARLY is the instant pull, GLIDE is always
     the auto-deploy window. Four rows on an instant pull, three otherwise. */
  /* `color` is carried through untouched. The solver has no opinion about it,
     but the page draws each phase's leg and its row dot from the phase object,
     so dropping it here leaves the flight path and the phase dots unpainted. */
  const P = {
    GLIDE_EARLY: { mode:'GLIDE_EARLY', label:GLIDE.label, color:GLIDE.color,
                   altitude:hGlideEarly, time:tGlideEarly, distance:dGlideEarly },
    DIVE:        { mode:'DIVE',        label:DIVE.label,  color:DIVE.color,
                   altitude:hDive, time:tDive,  distance:dDive },
    GLIDE:       { mode:'GLIDE',       label:GLIDE.label, color:GLIDE.color,
                   altitude:hGlideLate, time:tGlideLate, distance:dGlideLate },
    FREEFALL:    { mode:'FREEFALL',    label:FREEFALL.label, color:FREEFALL.color,
                   altitude:hFree, time:tFree,  distance:dFree }
  };
  /* No freefall row at all when the glider cannot be cut: there is no such
     phase in that mode, and showing it at 0.0s would imply one exists. */
  const phases = (glideFirst ? [P.GLIDE_EARLY, P.DIVE, P.GLIDE] : [P.DIVE, P.GLIDE])
    .concat(canCut ? [P.FREEFALL] : []);

  return {
    time: tDive + tGlide + tFree,
    phases, reach,
    cut: canCut,   // false in modes where the glider cannot be cut
    earlyDeploy: glideFirst,
    /* Height above the landing terrain at which the glider OPENS. Pulling
       early means pulling straight off the bus, so that is the full drop;
       otherwise it is the auto-deploy floor. */
    deployAltitude: glideFirst ? H : A,
    /* Where the early glide ends and the dive begins. Null when there is no
       early pull, since the whole descent above the floor is already a dive. */
    diveFromAltitude: glideFirst ? H - hGlideEarly : null,
    /* Ground distance from the exit at which the glider opens, for placing the
       deploy marker on the map. */
    deployDistance: glideFirst ? 0 : dDive,
    cutAltitude: hFree,                // height above terrain where you cut
    reopenAltitude: hReopen,           // height above terrain where you re-open
    diveVv: vvDive,                    // achieved dive descent rate
    minGlideAltitude: hGlideMin,
    distance: dGlideEarly + dDive + dGlideLate + dFree
  };
}

function maxReach(cfg, H) {
  const A = Math.min(cfg.autoDeployAltitude, H);
  const rD = ratio(cfg.modes.DIVE), rG = ratio(cfg.modes.GLIDE), rF = ratio(cfg.modes.FREEFALL);
  const canCut = cfg.canCut !== false;
  const hGlideMin = Math.min((cfg.minGlideTime || 0) * cfg.modes.GLIDE.vv, A);
  /* The bottom A metres are fixed. With a cut: minimum glide, then freefall,
     then the re-open. Without one the whole window is glide. Everything above
     is dive, or glide if the early pull is allowed. */
  const hGlideLate0 = canCut ? hGlideMin : A;
  const hFree0 = canCut ? A - hGlideMin : 0;
  const hReopen0 = canCut ? Math.min(cfg.landingRedeployAltitude || 0, hFree0) : 0;
  const dWindow = hGlideLate0 * rG + (hFree0 - hReopen0) * rF + hReopen0 * rG;
  const early = cfg.allowEarlyDeploy !== undefined
    ? cfg.allowEarlyDeploy : CONFIG.allowEarlyDeploy;
  return (H - A) * (early ? rG : rD) + dWindow;
}

/* --------------------------------------------------------------------------
   ROUTE - sample the bus line, solve the descent at each sample, keep the
   best total of bus time plus air time.
   -------------------------------------------------------------------------- */
function solveRoute(opts) {
  const cfg = {
    modes: opts.modes || CONFIG.modes,
    autoDeployAltitude: opts.autoDeployAltitude !== undefined
      ? opts.autoDeployAltitude : CONFIG.autoDeployAltitude,
    landingRedeployTime: opts.landingRedeployTime !== undefined
      ? opts.landingRedeployTime : CONFIG.landingRedeployTime,
    minGlideTime: opts.minGlideTime !== undefined
      ? opts.minGlideTime : CONFIG.minGlideTime,
    /* This was missing, so every descent solved THROUGH the route solver had
       landingRedeployAltitude undefined and skipped the re-open entirely,
       freefalling all the way to the ground. Direct solveDescent calls were
       fine, which is why unit tests passed while the app was wrong. */
    landingRedeployAltitude: opts.landingRedeployAltitude !== undefined
      ? opts.landingRedeployAltitude : CONFIG.landingRedeployAltitude,
    allowEarlyDeploy: opts.allowEarlyDeploy !== undefined
      ? opts.allowEarlyDeploy : CONFIG.allowEarlyDeploy,
    /* Same class of bug as landingRedeployAltitude above, and it hid for the
       same reason: canCut was dropped here, so every OG route solved through
       this function came back with the glider cut allowed even though OG
       cannot cut. Direct solveDescent calls were fine, so the unit tests that
       exercised OG never saw it. template.html forwards its whole config and
       was always correct, which is why the shipped page never showed it. */
    canCut: opts.canCut !== undefined ? opts.canCut : CONFIG.canCut
  };
  const {
    busStart, busEnd, target,
    busAltitude, terrainElevation = 0,
    busSpeed = CONFIG.busSpeed,
    momentumTime = CONFIG.momentumTime,
    samples = CONFIG.samples
  } = opts;

  const H = busAltitude - terrainElevation;
  const rv = { x: busEnd.x - busStart.x, y: busEnd.y - busStart.y };
  const routeLen = Math.hypot(rv.x, rv.y);

  if (routeLen < EPS)  return { ok:false, reason:'degenerate-route' };
  if (H <= EPS)        return { ok:false, reason:'no-altitude', effectiveH:H };
  if (busSpeed <= EPS) return { ok:false, reason:'no-bus-speed' };

  const dir = { x: rv.x / routeLen, y: rv.y / routeLen };
  const routeTime = routeLen / busSpeed;

  /* Bus momentum carry: for momentumTime seconds after exit you still travel
     along the bus heading at bus speed while losing altitude at dive rate. */
  const momDrop = momentumTime * cfg.modes.DIVE.vv;
  const momRun  = momentumTime * busSpeed;
  const Hair = H - momDrop;
  if (Hair <= EPS) return { ok:false, reason:'momentum-exceeds-altitude', effectiveH:H };

  const reach = maxReach(cfg, Hair);
  let best = null, firstT = null, lastT = null, closest = Infinity, closestT = 0;

  const evalAt = (t) => {
    t = Math.max(0, Math.min(routeTime, t));
    const run = busSpeed * t;
    const busPos  = { x: busStart.x + dir.x * run, y: busStart.y + dir.y * run };
    const exitPos = { x: busPos.x + dir.x * momRun, y: busPos.y + dir.y * momRun };
    const d = Math.hypot(target.x - exitPos.x, target.y - exitPos.y);
    if (d < closest) { closest = d; closestT = t; }
    if (d > reach + 1e-6) return null;
    const air = solveDescent(cfg, Hair, d);
    if (!air) return null;
    if (firstT === null || t < firstT) firstT = t;
    if (lastT === null || t > lastT) lastT = t;
    const total = t + momentumTime + air.time;
    if (!best || total < best.total - 1e-12) {
      best = {
        total, busTime: t, airTime: air.time + momentumTime,
        jumpPos: busPos, exitPos, airDistance: d, air, reach,
        pctReach: reach > 0 ? d / reach : 0
      };
    }
    return total;
  };

  /* Coarse sweep of the whole route. */
  for (let i = 0; i <= samples; i++) evalAt((i / samples) * routeTime);

  /* The point of closest approach, solved rather than sampled. A uniform grid
     can step straight over a narrow feasible window and report a perfectly
     reachable drop as out of range, which is exactly the failure the coarse
     sweep alone produced. Projecting the target onto the route guarantees the
     single best candidate is always tested. */
  const proj = ((target.x - busStart.x) * dir.x + (target.y - busStart.y) * dir.y) - momRun;
  evalAt(proj / busSpeed);

  /* Refine around the best candidate. Total time is the sum of a linear bus
     term and an increasing function of a convex distance, so it is well
     behaved locally; shrinking brackets converge quickly and remove the
     residual grid error. */
  let centre = best ? best.busTime : closestT;
  let half = routeTime / samples;
  for (let round = 0; round < 4; round++) {
    for (let k = -20; k <= 20; k++) evalAt(centre + (k / 20) * half);
    centre = best ? best.busTime : centre;
    half /= 12;
  }

  if (!best) {
    return {
      ok:false, reason:'out-of-range', effectiveH:H, reach, routeTime,
      closestApproach:closest, closestAtT:closestT,
      shortfall: closest - reach
    };
  }
  return { ok:true, effectiveH:H, reach, routeLen, routeTime,
    windowStart:firstT, windowEnd:lastT, dir, ...best };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONFIG, EPS, ratio, wallsToMetres, solveDescent, maxReach, solveRoute };
}
