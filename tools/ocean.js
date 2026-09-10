/* Rebuild the ocean on the fortnite.gg stitch.

   Their tiles carry Epic's terrain composited onto their own page furniture: a
   flat grey backdrop (#2c2f36), a flat cyan lagoon band (#0c9ae5) fading up
   through #38c2fa into a soft white outer glow that follows the silhouette at
   constant width. The terrain is Epic's and is kept untouched. Everything the
   compositor added outside the coast is replaced with water sampled off Epic's
   own render of the previous island: a #264592 shelf running out to #0b3479.

   The mask is a flood fill inward from the border, so interior lakes and rivers
   can never be reached, and flooded pixels must be strongly blue so beaches and
   surf cannot be walked through. The white glow is then dissolved rather than
   cut: pixels near the waterline are blended toward the water in proportion to
   how white and how close to the line they are, which leaves coloured terrain
   alone and turns the outermost sand into something that reads as surf. */
const fs=require('fs');
const W=2048,H=2048,N=W*H;
const raw=fs.readFileSync(process.argv[2]);
const out=Buffer.from(raw);

const BG=[0x2c,0x2f,0x36],BAND=[0x0c,0x9a,0xe5],LIGHT=[0x38,0xc2,0xfa];
const px=i=>[raw[i*3],raw[i*3+1],raw[i*3+2]];
function segDist(c,a,b){let num=0,den=0;for(let k=0;k<3;k++){const d=b[k]-a[k];num+=(c[k]-a[k])*d;den+=d*d;}
 const t=den?Math.max(0,Math.min(1,num/den)):0;let s=0;
 for(let k=0;k<3;k++){const p=a[k]+(b[k]-a[k])*t;s+=(c[k]-p)*(c[k]-p);}return Math.sqrt(s);}
const accept=i=>{const c=px(i);
 if(segDist(c,BG,BG)<=26)return true;
 if(segDist(c,BG,BAND)<=30)return true;
 return c[2]-c[0]>60 && segDist(c,BAND,LIGHT)<=30;};

const outside=new Uint8Array(N);const st=[];
for(let x=0;x<W;x++){st.push(x);st.push((H-1)*W+x);}
for(let y=0;y<H;y++){st.push(y*W);st.push(y*W+W-1);}
while(st.length){const i=st.pop();if(outside[i])continue;if(!accept(i))continue;outside[i]=1;
 const x=i%W,y=(i/W)|0;if(x>0)st.push(i-1);if(x<W-1)st.push(i+1);if(y>0)st.push(i-W);if(y<H-1)st.push(i+W);}

/* Their band left thin antialiased remnants that the colour test just misses,
   which read as contour lines drawn in open water. Anything not-water that is
   small and wholly enclosed by water is one of those, never terrain. */
{
  const seen=new Uint8Array(N); let filled=0;
  for(let s0=0;s0<N;s0++){
    if(outside[s0]||seen[s0]) continue;
    const comp=[]; const q=[s0]; seen[s0]=1; let touchesEdge=false;
    while(q.length){
      const i=q.pop(); comp.push(i);
      const x=i%W,y=(i/W)|0;
      if(x===0||y===0||x===W-1||y===H-1) touchesEdge=true;
      const nb=[]; if(x>0)nb.push(i-1); if(x<W-1)nb.push(i+1);
      if(y>0)nb.push(i-W); if(y<H-1)nb.push(i+W);
      for(const j of nb) if(!outside[j]&&!seen[j]){seen[j]=1;q.push(j);}
    }
    if(!touchesEdge && comp.length<=40000){
      for(const i of comp) outside[i]=1;
      filled+=comp.length;
    }
  }
  console.log('  swept '+filled+' px of leftover band edge out of the water');
}
let n=0;for(let i=0;i<N;i++)n+=outside[i];
console.log('water mask: '+(100*n/N).toFixed(1)+'% of the image');

/* chamfer distances: offshore over water, and inland over the land side */
function chamfer(seed){
  const d=new Float32Array(N);
  for(let i=0;i<N;i++) d[i]=seed[i]?1e9:0;
  const rl=(i,j,w)=>{const v=d[j]+w; if(v<d[i]) d[i]=v;};
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;if(!seed[i])continue;
    if(x>0)rl(i,i-1,1);if(y>0)rl(i,i-W,1);
    if(x>0&&y>0)rl(i,i-W-1,1.4142);if(x<W-1&&y>0)rl(i,i-W+1,1.4142);}
  for(let y=H-1;y>=0;y--)for(let x=W-1;x>=0;x--){const i=y*W+x;if(!seed[i])continue;
    if(x<W-1)rl(i,i+1,1);if(y<H-1)rl(i,i+W,1);
    if(x<W-1&&y<H-1)rl(i,i+W+1,1.4142);if(x>0&&y<H-1)rl(i,i+W-1,1.4142);}
  return d;
}
const sea=chamfer(outside);
const land=new Uint8Array(N); for(let i=0;i<N;i++) land[i]=outside[i]?0:1;
const inland=chamfer(land);

const SHELF=[0x26,0x45,0x92],MID=[0x1c,0x34,0x80],DEEP=[0x0b,0x34,0x79];
const FALLOFF=80, mix=(a,b,t)=>a+(b-a)*t;
const water=(i)=>{
  /* Epic goes light only right at the beach and is open-water navy within a
     couple of hundred metres, so the ramp has to darken FAST. A smoothstep
     lingers near the shelf colour and reads as a glowing ring around the
     island at map zoom, which is what it looked like. */
  const d=Math.min(1,sea[i]/FALLOFF), t=Math.pow(d,0.6);
  const from=t<0.5?SHELF:MID, to=t<0.5?MID:DEEP, u=t<0.5?t*2:(t-0.5)*2;
  const x=i%W,y=(i/W)|0;
  const wob=2.5*Math.sin(x/190)*Math.cos(y/230)+1.5*Math.sin((x+y)/95);
  return [0,1,2].map(c=>mix(from[c],to[c],u)+wob);
};

/* 1. paint the water */
for(let i=0;i<N;i++){
  if(!outside[i]) continue;
  const w=water(i);
  for(let c=0;c<3;c++) out[i*3+c]=Math.max(0,Math.min(255,Math.round(w[c])));
}

/* 2. dissolve their glow on the land side of the line */
const GLOW=50;
for(let i=0;i<N;i++){
  if(outside[i]) continue;
  const d=inland[i];
  if(d>GLOW) continue;
  const c=px(i);
  const mn=Math.min(c[0],c[1],c[2]), mx=Math.max(c[0],c[1],c[2]);
  /* how much this reads as their white glow rather than as terrain */
  const bright=Math.max(0,Math.min(1,(mn-135)/70));
  const flat  =Math.max(0,Math.min(1,(70-(mx-mn))/50));
  /* Their glow is COOL and real sand is WARM, which is what separates them:
     beach reads about r-b +18 to +63, their halo reads -4 to +32 the other way.
     Without this the dissolve eats the beaches along with the glow. */
  const cool  =Math.max(0,Math.min(1,(c[2]-c[0]+10)/25));
  const nearLine=1-(d/GLOW);
  const a=Math.min(1,bright*flat*cool*nearLine*1.25);
  if(a<=0.01) continue;
  const w=water(i);
  for(let k=0;k<3;k++)
    out[i*3+k]=Math.max(0,Math.min(255,Math.round(mix(c[k],w[k],a))));
}
fs.writeFileSync(process.argv[3],out);
console.log('ocean rebuilt and glow dissolved');
