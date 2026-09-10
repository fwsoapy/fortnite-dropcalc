const {decodePNG} = require('./png.js');
const img = decodePNG(process.argv[2]);
const {w,h,channels,data} = img;
const A=(x,y)=>{ if(x<0||y<0||x>=w||y>=h) return 0; const i=(y*w+x)*channels;
  return channels===2?data[i+1]:channels===4?data[i+3]:255; };
const on=(x,y)=>A(x,y)>128;
const lab=new Int32Array(w*h).fill(-1); let c=0;
for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  if(!on(x,y)||lab[y*w+x]>=0) continue;
  const st=[[x,y]]; lab[y*w+x]=c;
  while(st.length){ const [a,b]=st.pop();
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const p=a+dx,q=b+dy;
      if(p>=0&&q>=0&&p<w&&q<h&&on(p,q)&&lab[q*w+p]<0){lab[q*w+p]=c;st.push([p,q]);}
    }}
  c++;
}
for(let k=0;k<c;k++){
  console.log('\n--- component '+k+' ---');
  for(let y=10;y<h-10;y++){
    let r='';
    for(let x=6;x<w-6;x++) r += lab[y*w+x]===k ? '#' : '.';
    if(/#/.test(r)) console.log(r);
  }
}
