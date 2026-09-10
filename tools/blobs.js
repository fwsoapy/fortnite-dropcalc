const fs=require('fs');
const W=2048,H=2048;
let mask=new Uint8Array(fs.readFileSync('./mask.bin'));
// Dilate so the letters of one label merge into a single blob.
function dilate(src,r){
  const tmp=new Uint8Array(W*H), out=new Uint8Array(W*H);
  for(let y=0;y<H;y++){let cnt=0;
    for(let x=0;x<W;x++){ if(src[y*W+x])cnt=r+1; else if(cnt)cnt--; if(cnt)tmp[y*W+x]=1; }
    cnt=0;
    for(let x=W-1;x>=0;x--){ if(src[y*W+x])cnt=r+1; else if(cnt)cnt--; if(cnt)tmp[y*W+x]=1; }
  }
  for(let x=0;x<W;x++){let cnt=0;
    for(let y=0;y<H;y++){ if(tmp[y*W+x])cnt=r+1; else if(cnt)cnt--; if(cnt)out[y*W+x]=1; }
    cnt=0;
    for(let y=H-1;y>=0;y--){ if(tmp[y*W+x])cnt=r+1; else if(cnt)cnt--; if(cnt)out[y*W+x]=1; }
  }
  return out;
}
const d=dilate(mask,14);
// Connected components on the dilated mask, centroid weighted by ORIGINAL ink.
const lab=new Int32Array(W*H).fill(-1); const blobs=[];
const stack=new Int32Array(W*H);
for(let i=0;i<W*H;i++){
  if(!d[i]||lab[i]>=0) continue;
  const id=blobs.length; let sp=0; stack[sp++]=i; lab[i]=id;
  let sx=0,sy=0,n=0,area=0;
  while(sp){
    const p=stack[--sp], x=p%W, y=(p/W)|0; area++;
    if(mask[p]){sx+=x;sy+=y;n++;}
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=x+dx,ny=y+dy; if(nx<0||ny<0||nx>=W||ny>=H)continue;
      const q=ny*W+nx; if(d[q]&&lab[q]<0){lab[q]=id;stack[sp++]=q;}
    }
  }
  if(n>0) blobs.push({x:sx/n,y:sy/n,ink:n,area});
}
blobs.sort((a,b)=>b.ink-a.ink);
const big=blobs.filter(b=>b.ink>=150);
console.log('blobs total',blobs.length,' with >=150 ink px:',big.length);
console.log('(32 POIs in the API)');
fs.writeFileSync('./blobs.json',JSON.stringify(big));
console.log(big.slice(0,8).map(b=>`(${b.x.toFixed(0)},${b.y.toFixed(0)}) ink=${b.ink}`).join('\n'));
