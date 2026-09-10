const blobs=require('./blobs.json');
const pois=require('./map_api.json').data.pois;
const W=2048;
// Model: px = s*wx + tx ,  py = s*fy*wy + ty   (fy = +1 or -1, uniform scale)
function fit(pi,pj,bi,bj,fy){
  const dwx=pois[pj].location.x-pois[pi].location.x;
  const dwy=(pois[pj].location.y-pois[pi].location.y)*fy;
  const dbx=blobs[bj].x-blobs[bi].x, dby=blobs[bj].y-blobs[bi].y;
  const den=dwx*dwx+dwy*dwy; if(den<1e-6) return null;
  const s=(dwx*dbx+dwy*dby)/den;                 // least squares scale, no rotation
  if(!(s>0)) return null;
  const tx=blobs[bi].x-s*pois[pi].location.x;
  const ty=blobs[bi].y-s*fy*pois[pi].location.y;
  // reject if the pair itself is inconsistent (would imply rotation)
  const ex=Math.abs(s*dwx-dbx), ey=Math.abs(s*dwy-dby);
  if(ex>30||ey>30) return null;
  return {s,tx,ty,fy};
}
const TOL=45;
function inliers(m){
  let n=0, err=0;
  for(const p of pois){
    const px=m.s*p.location.x+m.tx, py=m.s*m.fy*p.location.y+m.ty;
    let bd=1e9;
    for(const b of blobs){const d=Math.hypot(b.x-px,b.y-py); if(d<bd)bd=d;}
    if(bd<TOL){n++;err+=bd;}
  }
  return {n,err:n?err/n:1e9};
}
let best=null;
for(const fy of [1,-1])
for(let pi=0;pi<pois.length;pi++)for(let pj=pi+1;pj<pois.length;pj++)
for(let bi=0;bi<blobs.length;bi++)for(let bj=0;bj<blobs.length;bj++){
  if(bi===bj) continue;
  const m=fit(pi,pj,bi,bj,fy); if(!m) continue;
  const q=inliers(m);
  if(!best||q.n>best.q.n||(q.n===best.q.n&&q.err<best.q.err)) best={m,q};
}
console.log('best model:', JSON.stringify(best.m));
console.log('inliers:', best.q.n+'/'+pois.length, 'mean error', best.q.err.toFixed(1),'px');
const m=best.m;
console.log('\nmetres across the 2048 px image:', (W/m.s/100).toFixed(0));
console.log('y axis:', m.fy>0?'world +y is image DOWN (south up)':'world +y is image UP (north up)');
console.log('world x at image left  :', ((0-m.tx)/m.s).toFixed(0));
console.log('world x at image right :', ((W-m.tx)/m.s).toFixed(0));
console.log('world y at image top   :', ((0-m.ty)/(m.s*m.fy)).toFixed(0));
console.log('world y at image bottom:', ((W-m.ty)/(m.s*m.fy)).toFixed(0));
console.log('\nmatched POIs:');
for(const p of pois){
  const px=m.s*p.location.x+m.tx, py=m.s*m.fy*p.location.y+m.ty;
  let bd=1e9;
  for(const b of blobs){const d=Math.hypot(b.x-px,b.y-py); if(d<bd)bd=d;}
  if(bd<TOL) console.log('  '+p.name.padEnd(34)+' err '+bd.toFixed(0)+' px');
}
