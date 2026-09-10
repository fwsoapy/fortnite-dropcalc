# Re-measuring the world-to-image map transform

Run these **only if the map stops lining up**, which would mean Epic re-rendered
the island at different world bounds. The result is the `MAP_TRANSFORM` constant
near the top of the state block in `template.html`.

fortnite-api.com publishes POI world coordinates in cm but no map bounds, so the
transform is recovered from the images themselves.

The full-resolution island PNGs these scripts work on (`map.png`, `map_41.png`,
`og_map.png`) are not in the repository: they are 10 MB, nothing in the build
reads them, and the steps below re-download the ones they need. `map_41.png` is
the 41.x island the transform was originally measured on; if a script asks for
it, pull it from the API's image endpoint for that patch.

## Steps

From this `tools` directory:

```bash
curl -s https://fortnite-api.com/v1/map -o map_api.json
```

```bash
curl -s https://fortnite-api.com/images/map.png -o map_blank.png
```

```bash
curl -s https://fortnite-api.com/images/map_en.png -o map_en.png
```

```bash
node diff.js
```

```bash
node blobs.js
```

```bash
node ransac.js
```

## What each does

| Script | Role |
|---|---|
| `png.js` | Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced) using only core `zlib`. No dependencies. |
| `diff.js` | Subtracts the blank map from the labelled map to isolate label ink. Writes `mask.bin`. |
| `blobs.js` | Dilates by 14 px so the letters of one label merge, connected-components them, and writes ink-weighted centroids to `blobs.json`. |
| `ransac.js` | Matches blob centroids to POI world coordinates over scale, translation and y-flip, then reports the transform. |

## Reading the output

`ransac.js` prints the model, the inlier count and the mean error. The
measurement that produced the shipped constant matched **13 of 13 labelled POIs
at a mean of 1.9 px**, which is what "this is right" looks like. If it comes back
with a handful of inliers or a mean error in the tens of pixels, the fit failed
and the constant should not be changed.

It also prints `metres across the 2048 px image` (3098.6 at time of writing) and
the axis direction. Convert its `s`, `tx`, `ty` into the normalized form the app
uses by dividing all three by the image width:

```
a = s / 2048        c = tx / 2048
e = s / 2048        f = ty / 2048
metresAcross = 2048 / s / 100
```

Only 13 of the 32 API entries are labelled on the map; the rest are unnamed
landmarks, so 13 inliers is the expected maximum, not a shortfall.

After changing the constant, run `test-persist.js`: it re-checks six POIs against
their measured label pixels and will fail if the transform drifts.

---

## Checking the transform without re-measuring it

`node tools/check_transform.js` answers the cheaper question: does the
transform currently in `template.html` still fit the live island? It pulls the
POIs from the API, projects them, and complains if they stop landing where an
island's worth of POIs should. Exit 0 fits, 1 drifted, 2 could not check.

It runs weekly in CI. When it fires, that is the signal to run the steps above.
