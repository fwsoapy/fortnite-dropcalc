/* REFRESH THE BATTLE ROYALE ISLAND FROM fortnite.gg, IN ONE COMMAND.

   Why this exists: fortnite-api.com is the only source the page can use at
   RUNTIME (it is the only one that sends CORS headers), but it mirrors Epic and
   lags, sometimes by days. fortnite.gg is current on day one but can never be a
   runtime source: its tiles send no Access-Control-Allow-Origin at all, so a
   browser cannot draw them without tainting the canvas and breaking the
   share-image export. So it is a BUILD-TIME source, and this is the build step.

     node tools/refresh_map.js            check what version is live
     node tools/refresh_map.js --write    fetch, stitch, rebuild, install

   What it does:
     1. reads the current map version from fortnite.gg/data/en.js
     2. pulls the 64 zoom-3 tiles, which are 256 px each and so stitch to
        exactly the 2048 square this project uses
     3. rebuilds the ocean, because their tiles carry Epic's terrain composited
        onto their own page furniture: a flat grey backdrop, a flat cyan lagoon
        band and a white outer glow. tools/ocean.js replaces all of that with
        water sampled off Epic's own render. Their TERRAIN is untouched.
     4. writes map.png and map_embed.jpg, and prints the byte count that
        SUPERSEDED_MAP_BYTES in template.html should be set to

   Needs curl and ffmpeg on PATH, and a browser User-Agent or Cloudflare 403s.

   THE ONE THING THIS CANNOT DO is measure the world scale. The framing carries
   over (their pyramid is registered to the same projection as the API's render,
   verified by stitching their 41.20 tiles and laying them over the API's own
   map.png), but metresAcross does not follow from that. A new island wants one
   in-game distance reading before MAP_TRANSFORM can be trusted to the metre. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(ROOT, '.maptmp');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const WRITE = process.argv.includes('--write');

const curl = (url, out) => execFileSync('curl',
  ['-s', '-m', '60', '-A', UA, url].concat(out ? ['-o', out] : []),
  { maxBuffer: 1 << 28 });

/* 1. what island is live */
/* The bare URL serves a STALE edge copy: it answered 41.20 while the site was
   already on 42.00. Their page requests it with a build stamp, and any unique
   query string is enough to get the current object. Exactly the same trap the
   page's own map refresh had. */
const en = curl('https://fortnite.gg/data/en.js?cb=' + Date.now()).toString();
const m = en.match(/map"\s*:\s*"([\d.]+)"/);
if (!m) throw new Error('could not read the map version from fortnite.gg/data/en.js');
const version = m[1];
console.log('fortnite.gg is serving map version ' + version);

const embedded = path.join(ROOT, 'map_embed.jpg');
if (!WRITE) {
  console.log('current map_embed.jpg is ' + fs.statSync(embedded).size + ' bytes');
  console.log('\nrun with --write to fetch and install it');
  process.exit(0);
}

/* 2. the 64 zoom-3 tiles, row major so ffmpeg's tile filter lays them out right */
fs.mkdirSync(TMP, { recursive: true });
let i = 0;
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
  const f = path.join(TMP, 'img_' + String(i).padStart(3, '0') + '.webp');
  curl('https://fortnite.gg/maps/' + version + '/3/' + x + '/' + y + '.webp', f);
  if (!fs.statSync(f).size) throw new Error('empty tile at ' + x + '/' + y);
  i++;
}
console.log('fetched ' + i + ' tiles');

const stitched = path.join(TMP, 'stitched.png');
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', path.join(TMP, 'img_%03d.webp'),
  '-vf', 'tile=8x8', '-frames:v', '1', stitched]);

/* 3. their page furniture out, Epic's water in */
const rawIn = path.join(TMP, 'in.rgb'), rawOut = path.join(TMP, 'out.rgb');
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', stitched,
  '-pix_fmt', 'rgb24', '-f', 'rawvideo', rawIn]);
execFileSync(process.execPath, [path.join(__dirname, 'ocean.js'), rawIn, rawOut],
  { stdio: 'inherit' });

/* 4. install */
const mapPng = path.join(ROOT, 'map.png');
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
  '-s', '2048x2048', '-i', rawOut, '-frames:v', '1', mapPng]);
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', mapPng, '-q:v', '5', embedded]);
fs.rmSync(TMP, { recursive: true, force: true });

console.log('\nwrote map.png and map_embed.jpg (' + fs.statSync(embedded).size + ' bytes)');
console.log('now:');
console.log('  1. npm run build');
console.log('  2. set SUPERSEDED_MAP_BYTES in template.html to whatever');
console.log('     curl -sI https://fortnite-api.com/images/map.png reports for');
console.log('     Content-Length, so the lagging API cannot overwrite this map');
console.log('  3. read one in-game distance and clear provisional on MAP_TRANSFORM');
