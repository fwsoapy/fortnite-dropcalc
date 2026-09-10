/* Trace a PNG's alpha mask into SVG path data.
   Every boundary between an opaque and a transparent pixel becomes a unit
   segment; the segments chain into closed loops. Outer loops and holes both
   fall out of this, so the result renders correctly with fill-rule evenodd. */
const {decodePNG} = require('./png.js');
const img = decodePNG(process.argv[2]);
const {w,h,channels,data} = img;
const alpha = (x,y) => {
  if (x<0||y<0||x>=w||y>=h) return 0;
  const i=(y*w+x)*channels;
  return channels===2 ? data[i+1] : channels===4 ? data[i+3] : 255;
};
const inside = (x,y) => alpha(x,y) > 128;

const key = (p) => p[0]+','+p[1];
const edges = new Map();                    // start point -> end point
for (let y=0;y<h;y++) for (let x=0;x<w;x++){
  if (!inside(x,y)) continue;
  if (!inside(x,y-1)) edges.set(key([x,y]),     [x+1,y]);      // top
  if (!inside(x+1,y)) edges.set(key([x+1,y]),   [x+1,y+1]);    // right
  if (!inside(x,y+1)) edges.set(key([x+1,y+1]), [x,y+1]);      // bottom
  if (!inside(x-1,y)) edges.set(key([x,y+1]),   [x,y]);        // left
}
const loops = [];
while (edges.size){
  const startK = edges.keys().next().value;
  let cur = startK.split(',').map(Number);
  const loop = [];
  while (true){
    const k = key(cur);
    const nxt = edges.get(k);
    if (!nxt) break;
    edges.delete(k);
    loop.push(cur);
    cur = nxt;
    if (key(cur) === startK) break;
  }
  if (loop.length > 3) loops.push(loop);
}
/* Drop points that sit on a straight run. */
const simplify = (pts) => pts.filter((p,i) => {
  const a = pts[(i-1+pts.length)%pts.length], b = pts[(i+1)%pts.length];
  return (b[0]-a[0])*(p[1]-a[1]) !== (b[1]-a[1])*(p[0]-a[0]);
});
const out = loops.map(simplify).map(l =>
  'M' + l.map(p => p.join(' ')).join('L') + 'Z').join('');
console.log('loops: ' + loops.length + '   path chars: ' + out.length);
console.log('\n' + out);

/* Winding check: with the edge convention above every solid outline runs the
   same way, so fill-rule nonzero fills both shapes instead of punching one out. */
const area = (l) => { let a=0;
  for (let i=0,j=l.length-1;i<l.length;j=i++) a += l[j][0]*l[i][1] - l[i][0]*l[j][1];
  return a/2; };
console.error('signed areas: ' + loops.map(l => area(l).toFixed(0)).join(', '));
