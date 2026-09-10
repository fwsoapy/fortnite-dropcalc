const {decodePNG} = require('./png.js');
const a = decodePNG('./map_blank.png'), b = decodePNG('./map_en.png');
console.log('blank ', a.w+'x'+a.h, 'channels', a.channels);
console.log('labels', b.w+'x'+b.h, 'channels', b.channels);
if (a.w!==b.w||a.h!==b.h) throw new Error('size mismatch');
// Label mask: pixels where the labelled map differs materially from the blank.
const W=a.w,H=a.h, mask=new Uint8Array(W*H);
let n=0;
for(let i=0;i<W*H;i++){
  const pa=i*a.channels, pb=i*b.channels;
  const d=Math.abs(a.data[pa]-b.data[pb])+Math.abs(a.data[pa+1]-b.data[pb+1])
         +Math.abs(a.data[pa+2]-b.data[pb+2]);
  if(d>60){mask[i]=1;n++;}
}
console.log('label pixels:', n, '('+(100*n/(W*H)).toFixed(2)+'% of image)');
require('fs').writeFileSync('./mask.bin', Buffer.from(mask));
console.log('mask written');
