# Internals

How the thing is put together, and the list of things that were got wrong at
least once. Read the [rules](#rules-learned-the-hard-way) before changing
anything: several of them were learned by breaking the project first.

The physics lives in [physics.md](physics.md), not here.

---

## What this is

A single self-contained `drop-solver.html` Fortnite battle bus drop calculator.
No build step for the end user, no dependencies. It opens straight off `file://`.
Both map images (Battle Royale and OG) are inlined as base64 data URIs so it works
fully offline, and on each load it also tries to pull the current map and POI list
from the public `fortnite-api.com` endpoint so a new Battle Royale season needs no
rebuild. Every part of that fetch is optional: offline, the embedded maps are used
and nothing degrades. **The API only ever serves Battle Royale**, so OG rides on
its embedded image and is hand-refreshed each OG season.

A **Mode** picker switches between Battle Royale and OG. Same flight speeds; OG
cannot cut the glider, so it has no freefall phase, and it has its own island and
its own measured scale.

You place the bus route (start and end markers) and a landing spot on the map,
optionally set a wall-height offset, press **Calculate**, and it tells you where
to jump and how to fly.

### Hard constraints, never to be violated

> "Manual input only. It must never read the running game. No overlays, no
> screen capture, no memory reading, no game files, no network traffic
> inspection. Epic banned all of that in April 2026 and only static tools where
> I enter the route myself are allowed. Do not add any auto-detection of the bus
> route."

Also:
- **No em dashes anywhere.** In code, comments, UI text, or chat.
- **No drop shadows** on map vectors. The user asked for them all removed.
- **Deviation from the original brief, agreed later.** The brief said "do NOT
  hardcode a meters-per-pixel scale, solve the world-to-image affine transform by
  least-squares fitting three or more POIs" through a calibration UI. The user
  later asked for every debug surface removed and everything hardcoded, which
  removed that UI. The intent was kept: the transform is still a least-squares
  fit over POIs, it is just done **offline against the labelled map image** and
  the measured result baked in, rather than asked of the user. Nothing about the
  scale is guessed. See [Map: self-updating, with the transform measured not
  guessed](#map-self-updating-with-the-transform-measured-not-guessed).
- Monospace tabular-nums for all numeric output.
- Works on desktop and phone, including touch drag.

---

## Files

| File | Role |
|---|---|
| `template.html` | **The page source. Edit this.** Carries the whole UI and three placeholders: `/*__SOLVER_JS__*/`, `__MAP_DATA_URI__`, `__OG_MAP_DATA_URI__`. |
| `solver.js` | **The physics. Edit this.** The only copy. Pure functions, no DOM, testable in node, inlined into the page at build time. |
| `build.js` | Fills the three placeholders and writes `drop-solver.html`. Path-relative, no dependencies. |
| `drop-solver.html` | **Build artifact, ~2 MB. Never hand-edit, never committed.** `npm run build` makes it. |
| `map_embed.jpg` | Battle Royale island, embedded. Refreshed live from the API at runtime, so this copy is only the offline fallback. |
| `og_map_embed.jpg` | OG island, embedded. **No API serves this**, so it is the only copy and has to be re-cut by hand each OG season. |
| `test.js` | Unit assertions against `solver.js`, including the in-game measurements every constant answers to, Battle Royale's and OG's kept separate. |
| `simulate.js` | Independent verification: brute force, closed-form geometry, sweeps. Deliberately does not re-run the solver's own assertions. |
| `test-persist.js` | Reads the **built** page and pulls `load`/`save`, `CONFIG`, `solveDescent`, both map transforms and the mode registry out of it by regex, so the shipped code is what runs, not a copy. |
| `tools/` | `refresh_map.js` pulls and rebuilds the current island in one command, `ocean.js` does the ocean rebuild it depends on, plus the scripts that measured the Battle Royale world-to-image transform and `og_scale.js` which fits the OG map scale from in-game distances. Only needed when a map stops lining up. See `tools/README.md`. |

Three source files are referenced in the history below and are deliberately not
in this repository, because they are other people's pages saved to disk:

- a saved shadcn dark page, which every design token was read off,
- a saved NA Drops page, the source of the 3.84 m wall and "Re-Open at ~6m",
- Violevo's [Fortnite-Drop-Calculator](https://github.com/Violevo/Fortnite-Drop-Calculator)
  (GPL-3.0), used as a visual reference only. No code from it is in here.

Also gone: a PDF that turned out to contain no physics at all (the only number
in it is `N = 400`), and the full-resolution map PNGs, which nothing in the
build reads.

### There is one solver, and it lives in solver.js

`solver.js` is the only copy of the physics. `build.js` inlines it verbatim into
`template.html` at the `/*__SOLVER_JS__*/` marker, exactly the way it inlines
the two map images, and `test-persist.js` checks the built page contains it byte
for byte and defines each solver function exactly once.

It was not always like this. The page used to carry its own second copy of the
solver so it could stay dependency-free, and the only thing holding the two
together was a test that compared their **constants**. That test could not see a
logic change at all, and one had already slipped through: `solveRoute` in
`solver.js` dropped `canCut` when it built its internal config, so every OG route
solved in node came back with the glider cut allowed in a mode that cannot cut.
The page, which forwarded its whole config, was right the entire time. Same bug
as rule 6 below, same cause, found the same way, one function later.

---

## Build and test

Node 18 or newer. No dependencies, nothing to install.

```bash
npm test          # build, then all three suites
npm run build     # just build drop-solver.html
```

Or without npm:

```bash
node build.js
node test.js
node simulate.js
node test-persist.js
```

Run **all three** suites. They cover different things and each has caught bugs
the others could not:

- `test.js` tests `solver.js` directly.
- `simulate.js` is deliberately written to not re-run the solver's own
  assertions. It caught `solveRoute` silently dropping `landingRedeployAltitude`.
- `test-persist.js` tests the built page's `load`/`save`, which the other two
  cannot see at all because they only import `solver.js`. It caught the stale
  localStorage class of bug. It builds the page first if it is missing, so it
  can never be testing a stale artifact.

CI runs the same `npm test` on every push. Pushing to `main` also builds the
page and publishes it to GitHub Pages, and tagging `v*` attaches it to a
release.

A fourth check runs weekly on a schedule rather than on a push:
`tools/check_transform.js` pulls the live POIs and projects them through
`MAP_TRANSFORM` to confirm it still fits the island. That is the one failure
mode here that yields a confident wrong answer rather than an error, since the
page would keep reporting distances against bounds that had moved. It needs the
network, so it is deliberately kept out of `npm test`, and an unreachable API
warns rather than fails. Its thresholds are loose on purpose: it is an alarm for
a re-rendered island, not a measurement. Every run prints the numbers it saw, so
the workflow log is the record of what normal looks like.

---

### The map is rebuilt, not just downloaded

`node tools/refresh_map.js --write` is the whole season refresh: it reads the live
version from fortnite.gg, pulls the 64 zoom-3 tiles, stitches them to the 2048
square, rebuilds the ocean and writes `map.png` and `map_embed.jpg`. Run
`build.js` after it. Deterministic: running it twice gives a byte-identical
`map_embed.jpg`.

**Their tiles are not a map, they are a map on a web page.** Epic's terrain art is
exact, but it is composited onto fortnite.gg's own furniture: a flat grey
backdrop (`#2c2f36`) filling the corners, a flat cyan lagoon band (`#0c9ae5`)
and a soft white outer glow following the silhouette. Dropped in as-is it reads
as a cartoon island floating on grey. `tools/ocean.js` replaces all of it:

- **the mask is a flood fill inward from the image border**, so interior lakes
  and rivers can never be reached: they are not connected to the outside. It
  accepts their backdrop, the backdrop-to-band blend, and their cyan family only
  where the pixel is unmistakably blue, so beaches and surf cannot be walked
  through.
- **leftover band edge is swept by connected component**, since antialiased
  pixels just miss the colour test and read as contour lines drawn in open water.
  Anything not-water, small, and wholly enclosed by water is theirs. *Explore
  each component fully:* an early `break` on size leaves a half-explored
  landmass, whose remaining pixels come back round as fresh small components and
  get flooded. That bug painted a navy stripe across the terrain.
- **the water is Epic's own**, sampled off `map_41.png` stepping offshore: a
  `#264592` shelf out to `#0b3479`. The ramp must darken FAST (`d^0.6` over
  80 px, not a smoothstep over 115) or the shelf colour lingers and reads as a
  glowing ring around the island at map zoom.
- **their white glow is dissolved, not cut**, blended toward the water by how
  white, how flat and how close to the waterline it is. The discriminator that
  makes this safe is temperature: their halo is COOL, real sand is WARM, so
  beaches survive.

### Never add UI text

Standing instruction, given three times. The panel states values and never
explains them. `#modeHint` and `#wallHint` are deleted outright rather than
blanked, so there is no element left to fill back in. Caveats that matter, like
`provisional` on a transform, stay as data and stay in these comments and in this
file, never in the DOM.

---

## The UI

### The whole UI

**Wall-height slider, Calculate button, Saved drops.** That is all there is.

### There is no debug menu, and there must not be one

The `Ctrl+Shift+X` advanced panel is **gone**, along with manual map calibration,
the map-image swap (file picker, drag-drop, paste), the reset-constants button
and the editable settings object. Every constant is hardcoded in `CONFIG` and
read fresh on each load.

`test-persist.js` fails the build if any of it comes back: it greps the source
for `id="adv"`, `.adv-card`, a ctrl+shift keydown handler, `renderAdv`,
`advResetBtn`, `placeCalib`/`fitAffine`, `id="fileInput"`, `id="dz"` and
`S.settings`. Verified to actually trip.

Drop height is no longer adjustable either: `CONFIG.busAltitude` is a flat 830 m,
since the bus flies the same height every match and exposing it only ever let it
be set wrong.

### Map

- Canvas draws only the map bitmap under a view transform, using sub-rectangle
  `drawImage` at full devicePixelRatio for sharpness.
- All vectors and markers live in an **SVG overlay in screen coordinates**, so
  they stay sharp and constant size at any zoom.
- Zoom at cursor with the wheel, drag to pan, pinch on touch, reset button.
  Marker positions are stored normalized 0-1, so they survive zoom and a map
  image swap.

### Map vector styling (the user iterated on this a lot, do not casually change it)

```js
// Bus route: stroked V arrows, static, no animation, no drop shadow
const ROUTE_W = 3, ROUTE_STEP = 20, ROUTE_DEPTH = 6, ROUTE_HALF = 6;
// path 'M-6 -6 L0 0 L-6 6', stroke var(--c-route), width 3, round cap/join,
// group opacity .9
// n = min(400, max(2, floor(L / ROUTE_STEP))), placed at ((i + 0.5) / n) * L

// Bus markers: plain blue circle with a white ring
circle r=18 fill transparent            // hit area
circle r=9  fill var(--c-marker) stroke #ffffff stroke-width 2.5
// label 'Start' / 'End' at y=24, fill #cfefff, stroke rgba(4,10,18,.85),
// stroke-width 3.5, paint-order 'stroke fill'

// Landing pin: flat blue, NO outline, genuinely transparent hole
path d='M0 0 C0 0 10 -12.5 10 -20 A10 10 0 1 0 -10 -20 C-10 -12.5 0 0 0 0 Z
        M0 -24.2 A4.2 4.2 0 1 1 0 -15.8 A4.2 4.2 0 1 1 0 -24.2 Z'
     fill-rule='evenodd' fill='var(--c-marker)'
// the evenodd compound path is what makes the hole transparent rather than
// filled with the background colour

// Flight legs: repo-style dashes, width 3, opacity .9, no dark backing stroke
const DASH = { GLIDE_EARLY:null, DIVE:'10 8', GLIDE:null, FREEFALL:'8 6' };
// transition dots r=7.5, fill = next phase colour, stroke #ffffff width 2
// green r=7.5 markers labelled 'Pull insta' (leg 0, early deploy only)
// and 'Auto deploy' (the GLIDE leg), label 13px above
```

### Design tokens (read off a saved shadcn page, from live computed styles)

```css
--background:#0a0a0a; --foreground:#fafafa; --card:#171717; --popover:#171717;
--secondary:#262626; --muted:#262626; --muted-foreground:#a1a1a1;
--accent:#262626; --primary:#006bff; --primary-foreground:#ffffff;
--destructive:#ff6467; --warning:#f99c00; --success:#00c758;
--border:rgba(255,255,255,.10); --input:rgba(255,255,255,.15); --ring:#737373;
--ghost:rgba(255,255,255,.045); --radius:.625rem;
--font-sans:"Geist",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
--font-mono:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
/* map vectors */
--c-route:#00c8ff; --c-marker:#006bff; --c-jump:#ff6467;
--c-dive:#ff6467; --c-glide:#00c758; --c-freefall:#f99c00;
```

That page wins on any conflict. No invented gaming theme, no neon, no glow.

### Behaviour

- **Calculate is an explicit button.** Never live-recompute.
- Moving a marker **discards the result entirely** rather than showing a stale
  banner. The user explicitly asked for the "results are stale" message to be
  removed.
- Invalidation keeps the panel markup and only adds a `.stale` dim class.
  Re-rendering into the empty state collapsed the panel.

### Wall offset wiring

```js
terrainElevation: S.elevation + wallsToMetres(st.wallOffset)
// syncWalls() sets #wallValue ('+5 walls') and nothing else. There is no
// #wallHint: the sentence under the slider ("Landing 19.2 m higher than
// expected, so less reach.") only restated the slider reading and was removed.
```

The mode hint under the picker is now for facts the screen cannot show. The
"glider can/cannot be cut" line and the "assumes you land on a rooftop, N m up"
line were removed for the same reason: they told the player what picking the
mode already told them. Only the provisional-map-scale warning survives, and
`#modeHint` is hidden outright when there is nothing to say.

### Persistence

`localStorage`, key `dropsolver.v5`. **Exactly three things are stored:**

```js
{ markers, drops, wallOffset }
```

No settings object, no constants, no transform, no elevation. Every physics
value is read from `CONFIG` on each load, so **retuning a constant now reaches
every existing browser on the next refresh**. This is the permanent fix for a bug
that shipped three separate times (see rule 4).

`test-persist.js` asserts the written payload has exactly those three keys and
that `settings`, `touched`, `modes`, `busSpeed`, `minGlideTime`,
`allowEarlyDeploy`, `transform`, `calib`, `elevation` and `dropHeight` never
appear in it. It also feeds `load()` seven malformed payloads (null markers,
missing points, NaN coordinates, non-array drops, out-of-range and NaN wall
offsets) and requires no throw and finite state after each.

Saved drops max 5, named, re-saving a name overwrites, loading clears the result.
Elevation is deliberately **not** saved: it is re-derived from live POI data, so
a saved drop follows the map when the season changes.

### Map: self-updating, with the transform measured not guessed

On load the page fetches `fortnite-api.com/v1/map` (8 s timeout) and swaps in the
current `images.blank`, so a new season's island appears with no rebuild. POIs
are taken live too and give the landing elevation via nearest-POI snap within
`CONFIG.snapRadius` (150 m). **Any failure leaves the embedded map in place** and
the tool carries on offline. The canvas only ever draws the image and never reads
pixels back, so a cross-origin map cannot break rendering.

**The API can be BEHIND the embedded map, and on a season launch it will be.**
When 42.00 shipped, `fortnite-api.com` was still serving the 41.x island hours
later, with 41.x POI coordinates, while the game itself was on the new one. It
mirrors Epic rather than being Epic. Diagnose it in one command, which rules the
client out entirely:

```bash
curl -s https://fortnite-api.com/images/map.png | md5sum
```

So the embedded island was cut from **fortnite.gg**, which versions its map in
the URL and had 42.00 the same day:

```
https://fortnite.gg/maps/{version}/{z}/{x}/{y}.webp    version from /data/en.js
```

Zoom 3 is an 8x8 grid of 256 px tiles, so it stitches to exactly the 2048 square
this project already uses: `ffmpeg -i img_%03d.webp -vf tile=8x8` over the 64
tiles in row-major `y` then `x` order. **Their pyramid is registered to the same
projection as the API's render**, which was verified rather than assumed: their
41.20 tiles stitch to an image whose coastline lands in the same pixels as the
API's own `map.png`, differing only in ocean styling.

**fortnite.gg cannot be a runtime source.** Its tiles send no
`Access-Control-Allow-Origin` at all, so a browser cannot draw them without
tainting the canvas, which breaks the share-image export (`toDataURL` throws).
It is also behind Cloudflare bot protection that 403s a plain request. It is a
build-time source only. The API stays the only live one.

**Which creates a new hazard: a stale mirror overwriting a newer embedded map.**
An ungated swap would have pulled the 41.x island back over the 42.00 one on
every load. `liveMapIsNotSuperseded()` HEADs the image first and refuses the one
asset known to be superseded, by exact byte count
(`SUPERSEDED_MAP_BYTES = 2613644`). Content-Length is CORS safelisted so it
reads cross-origin. Any failure keeps the embedded map, which is the safe
direction. **The check clears itself the moment the API publishes anything
different, and the constant can then be deleted.** The decision lives in a pure
`isSupersededMap(len)` so `test-persist.js` can test the behaviour with no
network.

**`MAP_TRANSFORM` is flagged `provisional` until 42.00 is measured in game.** The
framing carries over, confirmed above, but `metresAcross` does not follow from
that. Nothing published yet carries a 42.00 POI in Epic world units: the API is
still on 41.x coordinates, and fortnite.gg places markers in Leaflet
`CRS.Simple` space, which is image space with the world scale already divided
out. Inheriting a span across islands is what cost OG 18%, so it is flagged
rather than guessed and the page says so on screen. **To clear it:** stand in
one POI, mark another, compare the HUD metres against the tool, scale
`metresAcross` by measured/reported, and delete the flag.

**The image URL is cache busted, and it has to be.** The API serves the island
from one static URL, `/images/map.png`, under
`Cache-Control: public, max-age=31536000`, a year. The JSON request passes
`cache:'no-store'` so the metadata is always fresh, but the image is a plain
`img.src`, so a browser already holding `map.png` would never ask for it again
and a new season's island would never arrive. The refresh would look like it was
working and do nothing.

So `bustCache()` appends a UTC day stamp, `?v=YYYY-MM-DD`. Costs at most one
extra 2.6 MB fetch per browser per day and picks up a new island within 24 hours
of the API publishing it, which is well inside the API's own lag.

**Last-Modified cannot key this**, which is the non-obvious part: it was watched
moving from Aug 18 to Aug 20 inside a single session while the bytes stayed
md5-identical, because it tracks the CDN edge and not the asset. `Content-Length`
is honest but needs an extra round trip and `Vary: accept-encoding` makes it
wobble. `Date.now()` would re-download on every load and defeat the point of
embedding a map at all.

Busting happens where the URL is **captured**, not where it is used, because
`applyMapForMode()` reuses `liveMapImage` when coming back from OG; busting at
the use site would leave that path on the raw URL. `test-persist.js` pins all of
this under "the live map actually refreshes", including that nothing assigns the
raw API URL to `liveMapImage`.

**What this does not fix:** the API's own lag. It mirrors Epic's asset rather
than being Epic, and has been observed serving a byte-identical map three weeks
after a build bump (game on `41.30`, map md5 unchanged since Jul 31). If the
island looks stale, check the API before suspecting the page: compare the md5 of
`fortnite-api.com/images/map.png` against the local `map.png`.

The world-to-image transform is hardcoded because the API publishes POI world
coordinates but no map bounds. It was **measured**, not assumed: diff
`map_en.png` against `map.png` to isolate label ink, dilate and connect each
label into a blob, then RANSAC-match blob centroids to POI world coordinates.
All 13 labelled POIs matched to a **mean of 1.9 px**.

```js
const MAP_TRANSFORM = {          // world cm -> normalized image coords
  a: 3.2272561355e-6, b: 0, c: 0.47766145254,
  d: 0,               e: 3.2272561355e-6, f: 0.49632202277,
  metresAcross: 3098.6
};
```

- The 2048 px image spans **3098.6 m**, not the 3000 m that used to be guessed.
  (An earlier note in this file claimed the guess was 20-25% too big, based on
  POI spread. That was **wrong** - POIs sit inland, so their span understates the
  map. The real error was 3%.)
- World **+x is image right, +y is image DOWN**, determined empirically.
- The image is **not** centred on the world origin: it sits 69.2 m east and
  11.4 m south. Forcing the centre to the origin leaves a systematic 46 px error,
  so the offset is real.

`test-persist.js` re-checks six POIs against their measured label pixels (all
within 6 px), the span, the axis direction, the absence of rotation or shear, and
that `inv` actually inverts.

**If Epic ever re-renders the map at different world bounds, this is the one
thing that needs re-measuring.** The scripts that derived it (`png.js`,
`diff.js`, `blobs.js`, `ransac.js`) are described in `tools/README.md`.

### The OG map: embedded, hand-refreshed, scale still provisional

Every mode carries its own island and its own transform, paired in `MAPS` and
read through `mapFor(id)`. `applyMapForMode()` swaps both together on boot, on a
mode change, and when a shared link opens. They must never move separately: a
mode showing one island while measuring against another is wrong in a way
nothing downstream can detect.

**No Fortnite API serves the OG map, so OG cannot self-update.** This was
established by probing, not assumed:

- `/v1/map?season=og`, `?mode=og` and `?playlist=Playlist_Figment_BarkLine` all
  return a **byte-identical** body to the plain call. The parameters are ignored,
  not rejected.
- `/v1/map/og`, `/v1/og`, `/v1/maps` and `/v2/map` all 404. The documented
  endpoint takes **only** `language`.
- The image path is `map_<language>.png`, not `map_<mode>.png`:
  `images/map_og.png` returns `the requested language was not found` while
  `map_en/de/fr.png` are 200.
- `/v1/playlists` lists 7 OG playlists and carries **no map art at all**.
- `fortnite.gg/img/og-map.jpg` is the **current Battle Royale island cropped to
  16:9**, mislabelled. Do not use it.

The image ships from the Fortnite Wiki's per-patch renders, file naming
`Athena (vXX.YY) - Island - Fortnite.png`, 2048x2048. Append `?format=original`
or the CDN hands back WebP. The version tracks OG seasons: v41.10 was uploaded on
OG Season 9's start date, v40.10 on Season 8's. **So it goes stale every OG
season, roughly every 10 weeks**, and refreshing it is manual: fetch the newest
`Athena (v...)` render, convert to JPEG, drop it on `og_map_embed.jpg`, rebuild.

Everything touching `fortnite-api.com` is gated on `modeDef(S.mode).live`, which
only Battle Royale sets. That covers the island **and** the POIs: `applySnap()`
returns a flat sea-level elevation off the live island, because a POI is a
Battle Royale world coordinate and on any other island the nearest one is a place
that does not exist there.

```js
const OG_METRES_ACROSS = 2623.9;   // MEASURED IN GAME
```

**Only the scale matters on the OG map.** The offset genuinely does not: nothing
external is ever matched against this island, every point on it comes from the
user clicking, and every number the solver produces is a distance between two
clicks, so translating the whole island changes no answer. The origin therefore
sits at the image centre.

The scale could not be recovered the way the Battle Royale one was. That needed a
labelled render diffed against a blank one plus POI world coordinates to match
against; the wiki publishes no labelled OG twin and no API publishes OG
coordinates. Comparing island extents between renders does not settle it either,
because the wiki's renders carry a **decorative ocean gradient** that any
land-versus-water test latches onto instead of the coastline, which is why two
completely different islands measured to the same bounding box within 1 px.

So it came from the game, standing in the middle of Salty Springs and marking the
middle of three other POIs:

| to | in game | solver | error |
|---|---|---|---|
| Tilted | 593 m | 579 m | -2.4% |
| Paradise Palms | 713 m | 716 m | +0.5% |
| Sunny Steps | 1162 m | 1167 m | +0.4% |

One unknown fitted from three readings by least squares, so two are left over as
a check rather than an assumption. Tilted is the worst and also the largest POI,
so its middle is the least well defined. `tools/og_scale.js` holds the POI pixel
centres and redoes the fit; `test-persist.js` re-checks all three against the
shipped constant and fails if any drifts past 3%.

**This mattered.** The placeholder was the Battle Royale figure, and the Chapter 1
island is genuinely ~15% smaller, so every OG distance read **18% long** and the
jump call was out by seconds: on a mid-map drop the old number said jump at
T+10.8s where the measured one says T+8.4s.

The `provisional` flag on a transform is kept even though nothing sets it now: it
puts an orange warning under the mode picker. **Any future mode that ships before
its scale is measured must set it.**

### Landing ground height, and why only OG cares

`OG_TERRAIN_ELEVATION = 32.7`. Battle Royale gets ground height free: the API
ships a `z` per POI and the landing pin snaps to the nearest within `snapRadius`.
OG has no such feed, and the first cut used **sea level**, which shipped and was
reported as landing in front of the target rather than on it.

The reason it only hurt OG is how the flight ends:

| | final phase | ratio | reach lost per metre of ground |
|---|---|---|---|
| Battle Royale | FREEFALL | 0.16 | ~0.2 m |
| OG | GLIDE | 3.00 | ~3.0 m |

Ground the solver does not know about is altitude the flight never gets to spend,
and it is spent at the ratio of whatever phase was running at touchdown. So the
same wrong assumption is invisible in Battle Royale and about **19x** worse in
OG: at the median POI height it was a **53 m shortfall in OG** against 3 m in
Battle Royale. `tools/shortfall.js` reproduces the table, and it must use OG's
own glider to do it, running it against `CONFIG.modes.GLIDE` measures Battle
Royale and labels the answer OG.

`OG_TERRAIN_ELEVATION` is a **landing surface** height, not a terrain height:
**25.0 m of measured terrain plus a 7.68 m two storey roof = 32.7 m**.

The roof is the part that kept it short after the terrain was right. You do not
aim at the dirt beside a building, you aim at the building, and the flight stops
on its roof. A Fortnite house is two walls tall, and in OG every metre of that is
3.0 m of reach, so a roof is worth **23 m of reach**. Landing on open ground
instead is **-2 walls** on the slider.

The 25.0 m of terrain underneath it is **measured, by two independent routes that
agree**:

- Landing **25 m short** against 17.5 m of modelled ground. Ground costs 3.0 m of
  reach here, so 25/3.0 = 8.3 m was unaccounted for: real ground 25.8 m.
- Straight down reaching auto-deploy in **12.5 s**, which is 702.5 m of freefall,
  putting the ground at 830 - 100 - 702.5 = 27.5 m. Hand timing to a quarter
  second is worth +/-14 m, so this reading alone says 13 to 41 m.

**25.0 ships, the low end of both**, deliberately. The first reading back-solves
ground from a landing that was short, and part of that shortfall has since turned
out to belong to the glide ratio instead, so it is contaminated and cannot be
pushed any harder. The stopwatch reading is the clean one and it is also what
freezes this constant: see the OG glide ratio above. The original guess was 17.5,
the median of the 32 POI elevations the API publishes (range -3.6 to 61.2), and
both measurements sit comfortably inside that distribution.

**One constant still cannot be right everywhere.** Real ground varies over a range
worth more than 190 m of OG reach. The **wall offset is the per-drop correction**
and is worth **11.5 m of OG reach per wall**, which is one storey.

`test-persist.js` pins the whole chain: that OG is not at sea level, that it is
the measured 25 m, that Battle Royale still takes ground from live POIs, the 10x
sensitivity gap, and that the slider still reaches both sea level and high ground.

Saved drops are tagged with the mode they were saved in (`modeOf`, defaulting to
`br` for anything saved before modes existed) and listed only there, via
`dropsHere()`. Offering a Battle Royale pin on the OG island would point at open
water.

---

## Current shipped text

> "Dive it. Glider auto-deploys at 100 m: hold 2.2s, cut at 84.6 m, re-open at ~6 m to land."

---

## Rules learned the hard way

1. **Never edit `drop-solver.html`.** It is generated, it is not in git, and
   your edit is destroyed by the next build. Edit `template.html` for the page
   and `solver.js` for the physics.

2. **Change physics in `solver.js` only.** There is no second copy any more.
   Edit it, run `npm test`, run `npm run build`. If you find yourself writing a
   flight constant into `template.html`, stop: the UI-only config block is for
   colours and labels, and `test-persist.js` fails if a speed appears in it.

3. **Verify visuals by rendering to a pixel or ASCII grid and actually looking
   at it.** This is the single most important process lesson from this project.
   Geometry assertions confirmed path strings and spacing arithmetic while the
   user kept rejecting how it looked. Rendering to a character grid immediately
   found overlapping arrows (a 30 px glyph on a 23 px pitch) and an oversized
   glow (5 px on a 26 px glyph). Numeric checks repeatedly passed on visuals
   that were plainly wrong.

4. **Never persist a physics constant. Not one.** This shipped three times.
   Twice with `allowEarlyDeploy`, where a stored `false` kept beating a changed
   default and the user saw "short by 556 m" on a drop that was in range. Then
   with `minGlideTime`, where a stored `1.5` kept beating the shipped `2.0` and
   the panel still read "hold 1.5s" after a refresh, even though every source
   file said 2.0.

   Two clever fixes were tried and both were only partial. The real fix was to
   delete the whole category: there is no settings object, nothing is editable,
   and `localStorage` holds only `markers`, `drops` and `wallOffset`. **Do not
   add a settings object back**, and do not add a "just this one" tunable. If a
   constant needs to change, change `CONFIG` and rebuild.

5. **Do not assert a universal direction for how terrain elevation affects
   landing time.** There isn't one, and this was asserted wrongly twice. Raising
   the ground removes altitude, which lands you sooner, *and* removes reach,
   which makes you jump later. A close target lands sooner off higher ground, a
   far one lands later. Only effective drop and reach are monotone. The tests
   now pin both directions explicitly.

6. **Run `simulate.js` as well as `test.js`.** It found that `solveRoute` was
   dropping `landingRedeployAltitude` when building its internal cfg, so every
   descent solved *through the route solver* skipped the 6 m re-open. The unit
   tests all passed because they called `solveDescent` directly.

7. **Do not apply a cost after an optimiser has already chosen.** The original
   `cutCost` was applied after the LP picked its optimum, so it could never
   influence the choice.

8. **Watch for zero-width characters.** A U+200C got into `test.js` once and
   caused a `SyntaxError`.

9. **Do not route base64 image data through a response.** It gets corrupted.
   Use the build script.

10. **The jump lead is calibrated to a real race, and that beats every source.**
    Two players on one bus, 240 m perpendicular offset from an 830 m drop. The
    tool said jump 287 m early; the other player jumped later and landed **2 s
    sooner**. Reconstructing from the bus time saved puts the correct lead near
    71 m and the marginal ground speed at 28.4 m/s.

    Independently, technik-consulting.eu's rule of thumb (jump the offset divided
    by 3) gives 80 m for the same drop. Two unrelated sources inside 10 m of each
    other is the strongest evidence this project has. `DIVE.vh` 19 puts the tool
    at 77 m, between them.

    `test.js` pins it under "MEASURED IN GAME". **If that test fails the tool has
    drifted back toward jumping too early, the most persistent bug here.**

11. **Do not chase technik's 20-32 m/s band. It contradicts their own rule.**
    The band is an AVERAGE speed; the rule is set by the MARGINAL speed. Setting
    `DIVE.vh` to 32 to honour the band pushed the marginal to 58 and the lead to
    more than double the rule, which is what lost the race above. The same page's
    gamma table is separately inconsistent with its own stated bus speed, so its
    numbers were never one coherent model. The rule and the race win, the average
    ground speed consequently sits **below** the published band, and `test.js`
    asserts that deliberately so nobody "fixes" it back.

12. **The reference repo is NOT a timing anchor.** An earlier note here said it
    was, based on the user saying it felt right. It has the same equal-time flat
    region and would have lost the same race: for a 240 m offset it leads by
    about 350 m. Feel is not a measurement.


---

## History

Everything the user asked for is complete, built, tested and verified. There are
no outstanding tasks.

The last change was `minGlideTime` 1.5 -> 2.0 s, per: "ok its good just assume
that the cut time after gliding is 2 seconds not 1.5 because rn if you cut right
away you are just a bit too far forward". This moved the cut from 89.5 m to
86 m. Three tests that hardcoded the old cut altitude were rewritten to derive
it from the constant.

The source change alone was not enough. The user refreshed and still saw 1.5s,
because their localStorage held a copy from the older build. That led to the
`TUNED` / `S.touched` mechanism (see [Persistence](#persistence)),
`test-persist.js`, and rule 4.
Existing users self-heal on next load with no key bump and no loss of saved
drops.

### Suggestions offered, not accepted

The user was given a list of ideas and picked only the wall-height one. **Do not
start any of these without asking.**

- **In-app calibration** (the recommended next step): three solo drops to solve
  for the user's real dive vertical speed and glide ratio, which would replace
  the fitted `DIVE.vh 26.0` and `GLIDE.vh 22.0` with measured values.
- Surface map calibration on first run, since the scale currently defaults to a
  guess.
- Share a drop by URL.
- Compare two routes side by side.
- Arrow-key nudge on markers, key numbers on saved-drop rows, a countdown
  readout, export/import saved drops.
