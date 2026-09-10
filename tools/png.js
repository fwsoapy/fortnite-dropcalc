/* Minimal PNG decoder: enough for the fortnite-api map images (8-bit RGB/RGBA,
   non-interlaced). Only zlib from core, no dependencies. */
const fs = require('fs'), zlib = require('zlib');

function decodePNG(path){
  const buf = fs.readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png');
  let off = 8, w=0, h=0, bitDepth=0, colorType=0, interlace=0;
  const idat = [];
  while (off < buf.length){
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off+4, off+8);
    const data = buf.subarray(off+8, off+8+len);
    if (type === 'IHDR'){
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('bit depth '+bitDepth+' unsupported');
  if (interlace !== 0) throw new Error('interlaced unsupported');
  const channels = {0:1, 2:3, 3:1, 4:2, 6:4}[colorType];
  if (!channels) throw new Error('colour type '+colorType+' unsupported');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = channels;                      // bytes per pixel at 8 bit
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++){
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = out.subarray(y*stride, (y+1)*stride);
    const prev = y > 0 ? out.subarray((y-1)*stride, y*stride) : null;
    for (let x = 0; x < stride; x++){
      const a = x >= bpp ? cur[x-bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = (prev && x >= bpp) ? prev[x-bpp] : 0;
      let v = line[x];
      switch (filter){
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p-a), pb = Math.abs(p-b), pc = Math.abs(p-c);
          v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          break;
        }
        default: throw new Error('filter '+filter);
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, channels, data: out };
}
module.exports = { decodePNG };
