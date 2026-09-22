window.fat = async function(path, listing=false) {
 const read=async(o,n)=>new Uint8Array(await disk.read(o,n));
 const mbr=await read(0,512),base=new DataView(mbr.buffer).getUint32(454,true)*512;
 const boot=await read(base,512),v=new DataView(boot.buffer),bps=v.getUint16(11,true),cb=bps*boot[13];
 const ft=base+v.getUint16(14,true)*bps,data=ft+boot[16]*v.getUint32(36,true)*bps;
 let cluster=v.getUint32(44,true),size=0;
 async function chain(c) {let chunks=[],seen=new Set();while(c>=2&&c<0xffffff8){if(seen.has(c))throw Error('cycle');seen.add(c);chunks.push(await read(data+(c-2)*cb,cb));const f=await read(ft+c*4,4);c=new DataView(f.buffer).getUint32(0,true)&0xfffffff;}const out=new Uint8Array(chunks.length*cb);chunks.forEach((x,i)=>out.set(x,i*cb));return out;}
 function entries(a){let out=[],lfn=[];const d=new DataView(a.buffer);for(let i=0;i<a.length&&a[i];i+=32){if(a[i]===229){lfn=[];continue;}if(a[i+11]===15){if(a[i]&64)lfn=[];let t='';for(const j of [1,3,5,7,9,14,16,18,20,22,24,28,30]){const x=d.getUint16(i+j,true);if(x&&x!==65535)t+=String.fromCharCode(x);}lfn[(a[i]&31)-1]=t;continue;}const dec=new TextDecoder();const s=dec.decode(a.slice(i,i+8)).trim(),ext=dec.decode(a.slice(i+8,i+11)).trim();out.push({name:lfn.join('')||s+(ext?'.'+ext:''),short:s+(ext?'.'+ext:''),cluster:(d.getUint16(i+20,true)<<16)|d.getUint16(i+26,true),size:d.getUint32(i+28,true),attr:a[i+11]});lfn=[];}return out;}
 for(const n of path.split('/').filter(Boolean)){const e=entries(await chain(cluster)).find(e=>[e.name.toLowerCase(),e.short.toLowerCase()].includes(n.toLowerCase()));if(!e)return null;cluster=e.cluster;size=e.size;}
 const a=await chain(cluster);return listing?entries(a):Array.from(a.slice(0,size));
};
