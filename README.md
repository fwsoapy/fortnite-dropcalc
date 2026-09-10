# Fortnite Drop Calculator

Work out where to jump off the battle bus and how to fly, for a bus route and a
landing spot you place yourself.

**[Open it →](https://fwsoapy.github.io/fortnite-dropcalc/)**

![The solver working out a long drop](docs/screenshot.jpg)

It is one HTML file with no dependencies and no build step for you. Save it and
it opens straight off `file://`, offline, with both island maps already inside
it. On each load it also tries to pull the current Battle Royale map and POI
list from the public `fortnite-api.com` endpoint, so a new season needs no
update from me. That fetch is entirely optional: offline, it uses the embedded
maps and nothing else changes.

Manual input only. It never reads the running game. No overlay, no screen
capture, no memory reading, no game files, no traffic inspection. There is
nothing to auto-detect and nothing to install.

## The interesting part

Every flight constant in here was **measured in game with a stopwatch**, not
copied off a wiki, and the published numbers turned out to be wrong in ways
that matter.

The clearest example: this tool used to tell you to jump far too early, and it
lost a real race because of it. Two players, one bus, a 240 m perpendicular
offset. It said jump 287 m early; the other player jumped later and landed two
seconds sooner. What sets the jump point is not the average ground speed that
every source publishes, it is the **marginal** speed, how much extra time one
more metre of ground costs:

```
m    = (FREEFALL.vv*DIVE.vh - FREEFALL.vh*DIVE.vv) / (FREEFALL.vv - DIVE.vv)
lead = offset * m / sqrt(busSpeed² - m²)
```

Reconstructing from the bus time saved puts the correct lead near 71 m. A
published rule of thumb, from a completely unrelated source, gives 80 m for the
same drop. Two independent numbers within 10 m of each other, and the tool now
sits between them. The consequence is that the average ground speed in this
model sits **below** the range those same sources publish, and there is a test
that fails if anyone helpfully "fixes" it back.

The other one worth reading is the OG glide ratio. OG drops were landing 25 to
30 m short, and the shape of the miss gave it away: **it did not grow with
distance**. A fixed miss can only come from a phase whose altitude is the same
on every drop, and OG has exactly one, because it cannot cut the glider, so the
whole 100 m auto-deploy window is glide. The glider was opening 31 m further
out than it could actually cover, on every single drop, near or far.

There is a lot more of this, including one constant that is still an open
two-way fork nobody can settle without a stopwatch: **[docs/physics.md](docs/physics.md)**.

## Using it

Drag the **Start** and **End** markers to the bus route, click where you want
to land, press **Calculate**. It gives you the jump point, the time to land,
and each phase of the descent in order.

- **Mode** switches between Battle Royale and OG. They have their own islands
  and their own measured constants; OG cannot cut the glider, so it flies
  differently.
- **Wall height offset** raises or lowers the landing ground by whole walls,
  for dropping on a roof or into a hole.
- Saved drops and folders persist in the browser. Nothing is uploaded anywhere,
  and no physics constant is ever stored, which took three separate bugs to
  learn.

Works on a phone, including touch drag.

## Running it yourself

Node 18 or newer. There are no dependencies to install.

```bash
git clone https://github.com/fwsoapy/fortnite-dropcalc
cd fortnite-dropcalc
npm run build       # writes drop-solver.html
npm test            # build, then all three suites
```

`drop-solver.html` is not committed. It is a 2 MB single file that is mostly
base64 map data, so every rebuild would be a 2 MB diff. Build it, grab it from
the [releases](https://github.com/fwsoapy/fortnite-dropcalc/releases), or just
use the hosted copy above.

The physics lives in `solver.js` and nowhere else. `build.js` inlines it into
`template.html` along with the two maps, so the code that ships is the code the
tests ran against.

- [docs/physics.md](docs/physics.md): the model, every constant and where it
  came from, and where the published numbers fail
- [docs/internals.md](docs/internals.md): how the page is built, how the maps
  are rebuilt each season, and the list of things that were got wrong at least
  once

## Accuracy, honestly

The whole model rests on one person's hand-timed measurements from one drop
height. They over-determine the model and they all hold at once, which no
web-sourced set ever managed, but they are still one person with a stopwatch.

`busSpeed` in particular is unresolved. The raced 71 m lead pins a *pair* of
numbers, not either one, so 100 m/s and 75 m/s both reproduce it exactly and
there is no measurement between them. It is documented rather than papered
over, and the way to settle it is to time the bus between two points a known
distance apart. If you take that measurement, or any of the others, there is an
[issue template](https://github.com/fwsoapy/fortnite-dropcalc/issues/new?template=measurement.yml)
for it. Other people's stopwatches are the only thing that closes these.

## Credits and disclaimer

- Constants cross-checked against **dropmapsfn**, whose model is not adopted but
  which corroborated two figures and supplied one. The comparison is in
  [docs/physics.md](docs/physics.md).
- Two published numbers (`3.84 m` per wall, re-open at `~6 m`) come from
  **NA Drops**.
- **technik-consulting.eu** for the bus speed and auto-deploy altitude, and for
  the rule of thumb that independently confirmed the jump lead.
- Violevo's [Fortnite-Drop-Calculator](https://github.com/Violevo/Fortnite-Drop-Calculator)
  was a visual reference. No code from it is in here.
- Map data from [fortnite-api.com](https://fortnite-api.com) and
  [fortnite.gg](https://fortnite.gg).

Not affiliated with, endorsed by, or connected to Epic Games. Fortnite and all
map art are Epic's property. This is a fan-made tool.

Code is [MIT](LICENSE).
