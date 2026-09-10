const {decodePNG} = require('./png.js');
const img = decodePNG(process.argv[2]);
const {w,h,channels,data} = img;
const A=(x,y)=>{ if(x<0||y<0||x>=w||y>=h) return 0; const i=(y*w+x)*channels;
  return channels===2?data[i+1]:channels===4?data[i+3]:255; };
const on=(x,y)=>A(x,y)>128;
const key=p=>p[0]+','+p[1];
const edges=new Map();
for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  if(!on(x,y))continue;
  if(!on(x,y-1))edges.set(key([x,y]),[x+1,y]);
  if(!on(x+1,y))edges.set(key([x+1,y]),[x+1,y+1]);
  if(!on(x,y+1))edges.set(key([x+1,y+1]),[x,y+1]);
  if(!on(x-1,y))edges.set(key([x,y+1]),[x,y]);
}
const loops=[];
while(edges.size){
  const s=edges.keys().next().value; let cur=s.split(',').map(Number); const loop=[];
  while(true){ const k=key(cur), n=edges.get(k); if(!n)break;
    edges.delete(k); loop.push(cur); cur=n; if(key(cur)===s)break; }
  if(loop.length>3)loops.push(loop);
}
const chaikin=(p)=>{ const o=[];
  for(let i=0;i<p.length;i++){ const a=p[i], b=p[(i+1)%p.length];
    o.push([a[0]+0.25*(b[0]-a[0]), a[1]+0.25*(b[1]-a[1])]);
    o.push([a[0]+0.75*(b[0]-a[0]), a[1]+0.75*(b[1]-a[1])]); }
  return o; };
/* Douglas-Peucker on the open polyline, then close it. */
function dp(pts, tol){
  if (pts.length < 3) return pts;
  const d = (p,a,b) => {
    const vx=b[0]-a[0], vy=b[1]-a[1], L=Math.hypot(vx,vy);
    if (L < 1e-9) return Math.hypot(p[0]-a[0], p[1]-a[1]);
    return Math.abs((p[0]-a[0])*vy - (p[1]-a[1])*vx)/L;
  };
  const keep = new Uint8Array(pts.length); keep[0]=keep[pts.length-1]=1;
  const stack=[[0, pts.length-1]];
  while(stack.length){
    const [i,j]=stack.pop(); let best=-1, bd=tol;
    for(let k=i+1;k<j;k++){ const dd=d(pts[k],pts[i],pts[j]); if(dd>bd){bd=dd;best=k;} }
    if(best>0){ keep[best]=1; stack.push([i,best],[best,j]); }
  }
  return pts.filter((_,i)=>keep[i]);
}
const out = loops.map(l => dp(chaikin(chaikin(chaikin(l))), 0.18))
  .map(l => 'M' + l.map(p=>p[0].toFixed(2)+' '+p[1].toFixed(2)).join('L') + 'Z').join('');
console.error('loops '+loops.length+'  points '+out.split('L').length+'  chars '+out.length);
console.log(out);
