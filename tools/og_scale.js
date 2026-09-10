/* Fits the OG map scale from in-game marker distances.

   METHOD. Stand in the middle of one POI, place a map marker on the middle of
   another, read the metres off the HUD. Three readings from a single origin, so
   one unknown (metres per pixel) is fitted from three equations and the two
   spare ones become a check rather than an assumption.

   POI pixel centres were read off og_map.png (2048x2048) by cropping each POI
   at 3x with a 32 px grid and taking the middle of the built-up area. Rerun
   those crops if you ever want to second-guess a position:

     ffmpeg -i og_map.png -vf "crop=320:320:X:Y,drawgrid=w=32:h=32:t=1:c=red,\
       scale=960:960:flags=neighbor" out.png

   The answer is ~2620 m, NOT the 3098.6 m the Battle Royale map spans. The
   Chapter 1 island really is about 19% smaller, which is why carrying the
   Battle Royale figure over as a placeholder was wrong. */

const PX = {                     // centres in og_map.png pixels, 2048 square
  salty:    [1125, 1205],
  tilted:   [ 736,  975],
  paradise: [1622, 1461],
  sunny:    [1627,  445]
};

/* Measured in game, standing in the middle of Salty Springs. */
const FROM = 'salty';
const MEASURED = [
  ['tilted',    593],
  ['paradise',  713],
  ['sunny',    1162]
];

const IMAGE_PX = 2048;
const px = (a, b) => Math.hypot(PX[a][0]-PX[b][0], PX[a][1]-PX[b][1]);

/* Least squares through the origin: the scale that minimises the squared error
   over all three readings at once, rather than trusting any single one. */
let num = 0, den = 0;
for (const [poi, metres] of MEASURED){ const d = px(FROM, poi); num += d*metres; den += d*d; }
const mPerPx = num/den;
const across = mPerPx * IMAGE_PX;

console.log('OG map scale fitted from ' + MEASURED.length + ' in-game distances\n');
console.log('  from ' + FROM + ' at ' + PX[FROM].join(',') + ' px\n');
console.log('  target      px dist   measured   predicted   error');
let worst = 0;
for (const [poi, metres] of MEASURED){
  const d = px(FROM, poi), pred = d*mPerPx, err = pred - metres;
  worst = Math.max(worst, Math.abs(err/metres));
  console.log('  ' + poi.padEnd(10) + String(d.toFixed(1)).padStart(8)
    + String(metres).padStart(11) + 'm' + pred.toFixed(1).padStart(11) + 'm'
    + (err >= 0 ? '+' : '') + err.toFixed(1).padStart(7) + 'm  '
    + (err/metres*100).toFixed(1) + '%');
}
console.log('\n  metres per pixel   ' + mPerPx.toFixed(5));
console.log('  OG_METRES_ACROSS   ' + across.toFixed(1) + ' m');
console.log('  worst residual     ' + (worst*100).toFixed(1) + '%');
console.log('\n  for comparison, the measured Battle Royale map spans 3098.6 m,');
console.log('  so the OG island is ' + ((1 - across/3098.6)*100).toFixed(0) + '% smaller.');
