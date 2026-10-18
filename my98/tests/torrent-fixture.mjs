import {createHash,createPrivateKey,createPublicKey,sign} from 'node:crypto';
import {open} from 'node:fs/promises';
import {verifyMetadata} from '../my98/src/disk/web/torrent-protocol.js';

// Disposable public fixture signer, identical to my98's encrypted fixture identity.
const seed=Buffer.from('c80e4484997cdd302848d0348e56e84e089089fe14e03dcf681fe9ce0ba76944','hex');
const key=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),format:'der',type:'pkcs8'});
export const publicKey=createPublicKey(key).export({format:'der',type:'spki'}).subarray(-32).toString('hex');
function encode(value) {
 if(Number.isInteger(value))return Buffer.from('i'+value+'e');
 if(typeof value==='string')value=Buffer.from(value);
 if(value instanceof Uint8Array)return Buffer.concat([Buffer.from(value.length+':'),value]);
 return Buffer.concat([Buffer.from('d'),...Object.keys(value).sort().flatMap(k=>[encode(k),encode(value[k])]),Buffer.from('e')]);
}
export class TorrentFixture {
 constructor(){this.objects=new Map();this.sequence=1000;this.mode='online';this.requests=[];}
 async add(input,name) {
  const file=typeof input==='string'?await open(input,'r'):undefined;
  try {
   const bytes=file?undefined:Buffer.from(input),size=file?(await file.stat()).size:bytes.length,pieces=[];
   for(let offset=0;offset<size;offset+=262144) {
    const chunk=file?Buffer.alloc(Math.min(262144,size-offset)):bytes.subarray(offset,offset+262144);
    if(file)await file.read(chunk,0,chunk.length,offset);
    pieces.push(createHash('sha1').update(chunk).digest());
   }
   const info={name,length:size,'piece length':262144,pieces:Buffer.concat(pieces)};
   const hash=createHash('sha1').update(encode(info)).digest('hex');
   this.objects.set(hash,{bytes,file:typeof input==='string'?input:undefined,name,size,metadata:encode({info})});return hash;
  }finally{await file?.close();}
 }
 async publish(disk,state,profile) {
  this.descriptor=await this.add(Buffer.from(JSON.stringify({version:1,disk,state:state||null,profile:profile||null})),'publication.json');
  const salt=Buffer.from('my98/publication/v1'),sequence=++this.sequence;
  const payload=Buffer.concat([Buffer.from('4:salt'+salt.length+':'),salt,Buffer.from('3:seqi'+sequence+'e1:vd2:ih20:'),Buffer.from(this.descriptor,'hex'),Buffer.from('e')]);
  this.record={publicKey,sequence,infoHash:this.descriptor,signature:sign(null,payload,key).toString('hex'),salt:salt.toString('hex')};
  return this.descriptor;
 }
 sources(url){return {apis:[url],trackers:[],webseeds:[url+'/content']};}
 async adopt(hash,kind,sources) {
  for(const api of sources.apis)try {
   const response=await fetch(api+'/v1/torrents/'+hash+'.torrent',{signal:AbortSignal.timeout(10000)});
   if(!response.ok)continue;
   const metadata=new Uint8Array(await response.arrayBuffer()),parsed=await verifyMetadata(metadata,hash,kind);
   this.objects.set(hash,{name:parsed.filename,size:parsed.size,metadata,proxy:sources.webseeds});return;
  }catch{}
  throw Error('No verified metadata for '+hash);
 }
 async handle(req,res,url) {
  const path=url.pathname;if(!path.startsWith('/v1/')&&!path.startsWith('/content/'))return false;
  res.setHeader('Cache-Control','no-store');
  if(this.mode==='offline'){res.writeHead(503).end();return true;}
  if(path==='/v1/names/'+publicKey) {
   const record={...this.record};if(this.mode==='bad-signature')record.signature='00'.repeat(64);
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(record));return true;
  }
  const metadata=path.match(/^\/v1\/torrents\/([a-f0-9]{40})\.torrent$/);
  if(metadata&&this.objects.has(metadata[1])){res.end(this.objects.get(metadata[1]).metadata);return true;}
  const content=path.match(/^\/content\/([a-f0-9]{40})\/([^/]+)$/),object=this.objects.get(content?.[1]);
  if(object&&content[2]===object.name) {
   const range=req.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
   if(!range){res.writeHead(400).end();return true;}
   const first=+range[1],last=Math.min(+range[2],object.size-1);
   if(first>last){res.writeHead(416).end();return true;}
   this.requests.push({hash:content[1],first,last});
   let bytes=object.bytes?.subarray(first,last+1);
   if(object.proxy) {
    for(const source of object.proxy)try {
     const response=await fetch(source+'/'+content[1]+'/'+object.name,{headers:{Range:`bytes=${first}-${last}`},signal:AbortSignal.timeout(30000)});
     if(response.status!==206)continue;
     const data=new Uint8Array(await response.arrayBuffer());if(data.length!==last-first+1)continue;
     bytes=data;break;
    }catch{}
    if(!bytes){res.writeHead(503).end();return true;}
   }
   if(object.file){const file=await open(object.file);try{bytes=Buffer.alloc(last-first+1);await file.read(bytes,0,bytes.length,first);}finally{await file.close();}}
   res.writeHead(206,{'Content-Length':bytes.length,'Content-Range':`bytes ${first}-${last}/${object.size}`,'Accept-Ranges':'bytes'}).end(bytes);return true;
  }
  res.writeHead(404).end();return true;
 }
}
