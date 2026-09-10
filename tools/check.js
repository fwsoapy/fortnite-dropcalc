const {decodePNG} = require('./png.js');
const img = decodePNG(process.argv[2]);
const {w,h,channels,data} = img;
const A=(x,y)=>{ if(x<0||y<0||x>=w||y>=h) return 0; const i=(y*w+x)*channels;
  return channels===2?data[i+1]:channels===4?data[i+3]:255; };
const on=(x,y)=>A(x,y)>128;
// connected components of the ink
const seen=new Uint8Array(w*h); let comps=0, sizes=[];
for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  if(!on(x,y)||seen[y*w+x]) continue;
  comps++; let n=0; const st=[[x,y]]; seen[y*w+x]=1;
  while(st.length){ const [a,b]=st.pop(); n++;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const p=a+dx,q=b+dy;
      if(p>=0&&q>=0&&p<w&&q<h&&on(p,q)&&!seen[q*w+p]){seen[q*w+p]=1;st.push([p,q]);}
    }}
  sizes.push(n);
}
console.log('ink components: '+comps+'  sizes: '+sizes.join(', '));
// components of the transparent background, to count real holes
const seen2=new Uint8Array(w*h); let holes=0, hs=[];
for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  if(on(x,y)||seen2[y*w+x]) continue;
  let n=0, touchesEdge=false; const st=[[x,y]]; seen2[y*w+x]=1;
  while(st.length){ const [a,b]=st.pop(); n++;
    if(a===0||b===0||a===w-1||b===h-1) touchesEdge=true;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const p=a+dx,q=b+dy;
      if(p>=0&&q>=0&&p<w&&q<h&&!on(p,q)&&!seen2[q*w+p]){seen2[q*w+p]=1;st.push([p,q]);}
    }}
  if(!touchesEdge){ holes++; hs.push(n); }
}
console.log('enclosed holes: '+holes+'  sizes: '+hs.join(', '));
