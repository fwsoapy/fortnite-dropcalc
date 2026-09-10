const {decodePNG} = require('./png.js');
const f = process.argv[2], img = decodePNG(f);
const {w,h,channels,data} = img;
console.log(f.split(/[\/]/).pop() + '  ' + w + 'x' + h + '  channels ' + channels + '\n');
const px = (x,y) => {
  const i = (y*w + x)*channels;
  if (channels === 1) return {l:data[i], a:255};
  if (channels === 2) return {l:data[i], a:data[i+1]};
  if (channels === 3) return {l:data[i]*.299+data[i+1]*.587+data[i+2]*.114, a:255};
  return {l:data[i]*.299+data[i+1]*.587+data[i+2]*.114, a:data[i+3]};
};
const sx = Math.max(1, Math.round(w/60)), sy = Math.max(1, Math.round(h/30));
for (let y = 0; y < h; y += sy){
  let row = '';
  for (let x = 0; x < w; x += sx){
    const {l,a} = px(x,y);
    if (a < 40){ row += '.'; continue; }
    row += l > 200 ? '#' : l > 140 ? '+' : l > 80 ? '-' : l > 30 ? ':' : '@';
  }
  console.log(row);
}
