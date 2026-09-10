# The physics

Every flight constant in this tool was measured in game with a stopwatch. The
web was consulted, and the web was mostly wrong. This file is the record of
what was measured, what it fixes, what is still assumed, and where the
published numbers fail.

If you only read one part of it, read [Where the web was
wrong](#where-the-web-was-wrong) and [The bus speed fork, still
open](#the-bus-speed-fork-still-open).

Nothing here is tuned by feel. Every number below is either solved from a
measurement, taken from a named source and labelled as unverified, or labelled
as assumed. `test.js` asserts the measurements directly, so a constant quietly
edited back to a web value fails the suite.

---

## The model

A **fixed sequence** of flight phases, not a free convex mix. Each phase is a
`(vh, vv)` pair with glide ratio `r = vh / vv`.

Normal drop, three phases:

```
DIVE -> GLIDE -> FREEFALL
```

Long drop where the glider is pulled instantly off the bus, four phases:

```
GLIDE_EARLY -> DIVE -> GLIDE -> FREEFALL
```

The user's own description of the four-phase case, which the display must match:

> 1. jump out of bus
> 2. instant pull glider
> 3. go far enough forward
> 4. go back into dive, you dont cut you just go back into dive
> 5. go far enough forward
> 6. auto pull glider
> 7. free fall

Phase colours: green, red, green, yellow on instant pull. Red, green, yellow
otherwise.

### Key mechanics

- **Auto-deploy at 100 m**, hardcoded, not user editable.
- **MARGINAL GROUND SPEED IS THE WHOLE BALL GAME.** What sets the jump point is
  not `DIVE.vh` and not the average speed, it is how much extra time one more
  metre of ground costs:

  ```
  m = (FREEFALL.vv*DIVE.vh - FREEFALL.vh*DIVE.vv) / (FREEFALL.vv - DIVE.vv)
  lead = offset * m / sqrt(busSpeed^2 - m^2)
  ```

  At the shipped constants `m` = 30.4 m/s, giving a lead of about `offset/3`.
  **`DIVE.vv` must stay strictly below `FREEFALL.vv`**: when they were equal,
  steering became free, air time went flat inside dive reach and the solver
  bailed off the bus as early as it possibly could. See rule 10 in [internals.md](internals.md).
- **Mandatory terminal cut.** Every drop ends `glide(minGlideTime) -> cut ->
  freefall -> re-open at 6 m`.
- **Early pull is only used when the target is beyond dive range.** Short and
  mid drops read as plain dive plus auto-deploy.
- **Effective height** is `busAltitude - terrainElevation(landingSpot)`, where
  terrain elevation includes the wall offset.

### Current CONFIG (exact, from `solver.js`)

```js
modes: {
  DIVE:     { vh:20.4, vv:23.2 },   // MEASURED in game
  GLIDE:    { vh:23.2, vv: 7.0 },   // MEASURED in game
  FREEFALL: { vh: 9.0, vv:56.2 }    // vv MEASURED, vh still ASSUMED
},
autoDeployAltitude:      100,   // hardcoded
busSpeed:                100,   // technik-consulting.eu "100 m/s or 360 km/h"
minGlideTime:            2.0,   // from play; 1.5 cut too early and overshot forward
landingRedeployAltitude: 6,     // NA Drops "Re-Open at ~6m"
wallHeight:              3.84,  // NA Drops landingHeightOffsetMeters = 3.84 * walls
wallRange:               10,    // slider limit, plus and minus
landingRedeployTime:     0,     // assumed
momentumTime:            0,     // assumed, user said default to zero not an invented value
samples:                 4000,
allowEarlyDeploy:        true   // only used when target is beyond dive range
```

Default drop height is 830 m (advanced slider, 0-10 maps to 330..1330 m).

### Provenance of every constant

**THE FLIGHT SPEEDS ARE MEASURED IN GAME. THE WEB IS NOW ONLY A CROSS-CHECK.**

Measurements from an 830 m drop over flat ground. They over-determine the model
and all hold at once, which no web-sourced set ever managed:

| measurement | value | what it fixes |
|---|---|---|
| straight down, 830 m to auto-deploy | 13 s | `FREEFALL.vv` 56.2 |
| auto-deploy to the ground | ~4 s | `minGlideTime`, now 2.2 (see the cross-check below) |
| max dive, never pulling early | ~720 m | dive ratio 0.878 |
| max reach pulling instantly | ~2500 m | glide ratio 3.32 |
| race, 240 m offset, correct lead | ~71 m | marginal ground speed 28.4 m/s |
| bus jump window | 24 s | constrains route length, not the descent |

and four measured in **OG**, which apply to **OG only**:

| measurement | value | what it fixes |
|---|---|---|
| OG straight down to auto-deploy | 12.5 s | ground height ~27.5 m |
| OG auto-deploy to ground, gliding | ~20 s | **`GLIDE_OG.vv` 5.0**, an OG override |
| OG landing short of the pin | ~25 m | `OG_TERRAIN_ELEVATION` 25.0 m |
| OG landing short by the **same** amount on every drop | 25-30 m | **`GLIDE_OG.vh` 15.0**, ratio 3.0 |

The last one is the one to understand, because its shape is the whole diagnosis.
A miss that does not grow with distance can only come from a phase whose altitude
is the same on every drop, and OG has exactly one: it cannot cut, so the entire
100 m auto-deploy window is glide. The plan hands that window `100 * ratio`
metres of ground every single time, 331 m at the old 3.314, which is 100% of a
300 m drop and still 55% of a 600 m one, and holds the dive back to suit. So the
glider opened 31 m further from the target than it could actually cover, on every
drop, near or far. 100 m of window turns 0.25-0.30 of ratio into the 25-30 m
reported, giving 3.0.

Battle Royale cannot see this at all: it cuts after the floor, its window is
worth 79 m, and the dive does the work.

### Cross-checked against dropmapsfn, and what was taken from it

Their calculator ships its whole physics model in the client bundle, unminified
property names and all (`e964b67…js` for the constants, `11660f17…js` for the
descent math). It is the only other real implementation this project has been
able to read. Scored against the four things measured in game:

| measured in game | measured | dropmapsfn | ours |
|---|---|---|---|
| straight down, 830 → 100 m | **13 s** | 15.3 s | 13.0 s |
| max dive, never pulling early | **720 m** | 1020 m | 721 m |
| max reach, instant glider pull | **~2500 m** | 2371 m | 2503 m |
| race lead at a 240 m offset | **71 m** | 60 m | 71 m |

So their model is **not** adopted. Its skydive polar tops out at a 0.98 glide
ratio near level flight, which is a theoretical polar rather than what a player
sustains; its gravity integration at 9.81 m/s² is far slower than the game's snap
to terminal; and its glide ratio of 20/7 costs 130 m of measured max reach.
`test.js` asserts each rejection against the measurement it would break.

**Taken:**

- **`minGlideTime` 2.0 → 2.2**, their `initialCooldownS` for the same mechanic.
  An independent implementation's figure beats a feel-tuned one, and it
  continues the direction play already pushed this in (1.5 was too early). Cut
  moves 86 → 84.6 m, reach 2499 → 2503 m, jump lead unchanged.
- **`FREEFALL` 9.0 / 56.2 is now corroborated, not assumed.** Their polar's 65°
  row is 8.9 / 55.4. That constant was the one pure guess in the model and it
  appears in the marginal-speed formula, so it moves the jump point.

**Reconciled, not changed:** their `skydiveMaxVertical` 61.5 against our 56.2 is
not a disagreement. Theirs is a terminal velocity with an acceleration phase
below it; ours is the average over 730 m. Same fall, two descriptions, which
also shows their 9.81 acceleration is too slow.

### The bus speed fork, still open

`busSpeed` 100 is the only constant left with nothing behind it, and **the race
does not settle it.** `lead = offset * m / sqrt(busSpeed² - m²)` is one equation
in two unknowns, so the raced 71 m lead pins the **pair**, not either number:

| busSpeed | marginal | implied DIVE | |
|---|---|---|---|
| 100 | 28.4 | 20.38 / 23.18 | shipped |
| 80 | 22.7 | 17.77 / 20.21 | matches their polar |
| 75 | 21.3 | 17.04 / 19.38 | their bus speed |

All of them reproduce the race exactly. dropmapsfn ships 75 **and** a polar at
17.7–18.1 horizontal, so their two numbers are the same branch, self-consistently;
ours needs 20.4, above the 18.7 their model allows. Two coherent models, no
measurement between them, so the branch that has actually been played stays.

`tools/bus_fork.js` regenerates the table. **Whoever changes `busSpeed` must
re-solve `DIVE` in the same commit**, `test.js` fails if the pair stops
reproducing the raced lead. To settle it: time the bus between two POIs a known
distance apart.

### Battle Royale is the baseline and another mode must not move it

**A measurement taken in one mode belongs to that mode until it is measured in
the other.** The user's instruction is explicit: do not change Battle Royale.

OG measured a glider sink of 5.0 m/s where `CONFIG.modes.GLIDE` says 7.0. That
was first applied to the shared constant, which silently moved Battle Royale's
cut altitude (86 -> 90 m), its max reach (2498 -> 2486 m) and its jump lead at
long offsets (0.252 -> 0.157 lead per metre of offset). All of it was reverted.

The override now lives on the mode, in `modes_ui`:

```js
{id:'og', label:'OG', canCut:false, ready:true,
 speeds:{GLIDE:{id:'GLIDE', label:'Glide', vh:15.0, vv:5.0, color:'#00c758'}}}
```

`modeSpeeds(id)` shallow-merges `speeds` over a **copy** of `CONFIG.modes`, so a
mode declaring none (Battle Royale) gets `CONFIG.modes` byte for byte, and
`CONFIG` is never mutated. `buildOpts` passes `modes:modeSpeeds(S.mode)`.

**Why Battle Royale could never have caught this:** it cuts after the 2 s floor
and freefalls the rest, so a 5 m/s and a 7 m/s sink land within half a second of
each other on its stopwatch. `test.js` asserts that explicitly, so the "~4 s"
reading is never again mistaken for a confirmation of the sink rate.

The glide **ratio** used to be identical in both, 3.314, borrowed from the Battle
Royale max-reach measurement on the theory that only `vv` needed measuring. That
was the same cross-mode guess that had already shipped Battle Royale's island
scale and Battle Royale's sink rate into OG, and it was wrong a third time: OG is
**3.0**, `vh` 15.0 against the measured 5.0 sink.

Both numbers are round in the units the game stores (1500 and 500 uu/s), and 3.0
is the conservative end of the 3.014-3.064 band the reported miss implies. That
direction is deliberate. **Under-modelling OG reach is cheap and over-modelling
is not:** too little reach asks for a slightly earlier jump and you arrive over
the roof with altitude to spare, landing a fraction of a second late. Too much
reach puts you in the street.

**Do not fix the next OG shortfall with `OG_TERRAIN_ELEVATION`.** That lever was
used twice and is now closed: `830 - 32.7 - 100 = 697.3` m of freefall is 12.41 s
against the 12.5 s measured straight down, so the altitude budget is pinned by a
measurement that never touches the glider.

Dive ratio plus the marginal solve `DIVE` uniquely at 20.4 / 23.2. **`test.js`
asserts all of these under "MEASURED IN GAME". If one fails, a constant has been
changed on the strength of a web page instead of a stopwatch.** `test-persist.js`
separately asserts that Battle Royale declares no overrides, that the shared
glide is still 23.2 / 7.0, that OG overrides `GLIDE` and nothing else, and that
the merge is onto a copy.

Still not measured:
- **assumed** - `FREEFALL.vh 9.0`, `momentumTime 0`, `landingRedeployTime 0`.
- **sourced, unverified** - `busSpeed 100` and `autoDeployAltitude 100` from
  technik-consulting.eu (auto-deploy also on Fandom). `landingRedeployAltitude 6`
  and `wallHeight 3.84` from NA Drops.

### Where the web was wrong

technik's "glide 32" taken as a sustained speed
gives a marginal of 58 and a 172 m lead, more than double their own rule of
thumb and far outside the measured race. Their 60 m/s straight-down figure is
7% fast against the stopwatch (real 56.2). Their rule of thumb, though, lands
within 9 m of the measured lead, so it survives as a sanity check.

**Read the speed table correctly.** Its rows are speeds
*toward the target*, not fall rates. "glide 32" and "umbrella 20" are
horizontal, confirmed by the page's own line "v_z is the average speed towards
the finish and will range between 20 m/s (no free fall) and about 32 m/s (no use
umbrella)" - the same two numbers. Only "glide vertically downwards 60" and
"falling off bus, without further action 12" are vertical.

Misreading 32 as a fall rate already happened once: `DIVE.vv 32` was labelled a
technik anchor when it is really the repo's value and the match was coincidence.

**Why this pins the horizontals exactly.** In this model a pure-dive drop's
effective ground speed equals `DIVE.vh` by construction, and an all-glider
drop's equals `GLIDE.vh`. So the published 20-32 band fixes both directly. The
earlier fitted 26.0 / 22.0 undershot and overshot it. Cross-check: the page's
"divide the offset by 3" rule is the optimum of `offset / sqrt((vb/vz)^2 - 1)`,
which only lands on 3 when `vb=100` and `vz=32`.

**The page's gamma table (2.4 / 3.3 / 4.1) is internally inconsistent** with its
own bus speed - those values imply about 83.5 m/s, not 100. The divide-by-3 rule
does match 100. Trust the rule, not the gamma table.

NA Drops' physics is server-side (`POST /api/trajectory`) and could not be
extracted. Only their flight *structure* and the two published numbers above
were recovered.

Keep these labels accurate if you change anything.

---

## Solver API

```js
ratio(mode)                 // vh / vv
wallsToMetres(walls, cfg)   // clamps to +/-wallRange, rounds, times wallHeight
maxReach(cfg, H)
solveDescent(cfg, H, d)     // returns { time, phases[], reach, cut, earlyDeploy,
                            //   deployAltitude, diveFromAltitude, deployDistance,
                            //   cutAltitude, reopenAltitude, diveVv,
                            //   minGlideAltitude, distance }
solveRoute(opts)            // ok:true  -> { effectiveH, reach, routeLen, routeTime,
                            //   dir, total, busTime, airTime, jumpPos, exitPos,
                            //   airDistance, air, pctReach }
                            // ok:false -> reason in 'degenerate-route' | 'no-altitude'
                            //   | 'no-bus-speed' | 'momentum-exceeds-altitude'
                            //   | 'out-of-range'
```

`solveRoute` minimises `busTime + airTime`. It does **not** rely on uniform
sampling alone. A uniform grid steps over narrow feasible windows and
misclassified 12 out of 3000 reachable drops as out of range. It now does:

1. coarse uniform sweep over `samples` points
2. **analytic closest approach** evaluated explicitly
3. four rounds of shrinking local refinement (41 points each, half shrinks by 12)

Brute-force agreement went from a 0.51 s gap to **0.0000 s**.

---
