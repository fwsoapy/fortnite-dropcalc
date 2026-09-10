const {decodePNG} = require('./png.js');
const img = decodePNG(process.argv[2]);
const {w,h,channels,data} = img;
const A = (x,y) => { const i=(y*w+x)*channels;
  return channels===2 ? data[i+1] : channels===4 ? data[i+3] : 255; };
const Lu = (x,y) => { const i=(y*w+x)*channels;
  return channels<=2 ? data[i] : data[i]*.299+data[i+1]*.587+data[i+2]*.114; };
console.log('alpha map (64x64), @ = opaque ink, . = transparent\n');
for (let y=0;y<h;y++){
  let r='';
  for (let x=0;x<w;x++){
    const a=A(x,y), l=Lu(x,y);
    r += a<30 ? '.' : (l>160 ? '@' : a<140 ? ':' : '+');
  }
  console.log(r);
}
