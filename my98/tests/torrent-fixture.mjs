import {createHash,createPrivateKey,createPublicKey,sign} from 'node:crypto';
import {open,readFile} from 'node:fs/promises';
import {chromium} from '../my98/node_modules/playwright/index.mjs';
import TrackerServer from '../my98/node_modules/bittorrent-tracker/server.js';

// Public disposable identity; the browser consumers receive only signed records.
const seed=Buffer.from('c80e4484997cdd302848d0348e56e84e089089fe14e03dcf681fe9ce0ba76944','hex');
const key=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),format:'der',type:'pkcs8'});
export const publicKey=createPublicKey(key).export({format:'der',type:'spki'}).subarray(-32).toString('hex');
const sha1=bytes=>createHash('sha1').update(bytes).digest();
const salt=Buffer.from('my98/publication/v1');
function encode(value) {
 if(Array.isArray(value))return Buffer.concat([Buffer.from('l'),...value.map(encode),Buffer.from('e')]);
 if(Number.isInteger(value))return Buffer.from('i'+value+'e');
 if(typeof value==='string')value=Buffer.from(value);
 if(value instanceof Uint8Array)return Buffer.concat([Buffer.from(value.length+':'),value]);
 return Buffer.concat([Buffer.from('d'),...Object.keys(value).sort().flatMap(k=>[encode(k),encode(value[k])]),Buffer.from('e')]);
}
export class TorrentFixture {
 constructor(){this.objects=new Map();this.sequence=1000;this.mode='online';this.requests=[];}
 async start(url) {
  this.url=url;this.tracker=new TrackerServer({udp:false,http:false,ws:true,stats:false});
  await new Promise((resolve,reject)=>{this.tracker.once('error',reject);this.tracker.listen(0,'127.0.0.1',resolve);});
  this.trackerURL='ws://127.0.0.1:'+this.tracker.http.address().port;
  // A native seeder exposes literal ICE addresses; make the local browser seeder
  // do the same so separate headless processes do not depend on mDNS.
  this.browser=await chromium.launch({args:['--disable-features=WebRtcHideLocalIpsWithMdns']});this.page=await this.browser.newPage();
  await this.page.addInitScript(()=>{const RTC=RTCPeerConnection;window.RTCPeerConnection=new Proxy(RTC,{construct(Target,args,newTarget){args[0]={...args[0],iceServers:[]};return Reflect.construct(Target,args,newTarget);}});});
  await this.page.goto(url+'/fixture/seeder.html');
  await this.page.evaluate(async()=>{
   const {default:WebTorrent}=await import('/build/my98-runtime/build/torrent/webtorrent.min.js');
   window.seeder=new WebTorrent({dht:false,lsd:false,utp:false,webSeeds:false,tracker:{}});
   seeder.on('error',error=>console.error(error));
   window.seedObject=async({metadata,hash,tracker})=>{
    if(await seeder.get(hash))return;
    class Store {
     constructor(piece,{length}){this.piece=piece;this.length=length;this.pending=new Map();}
     get(index,options,callback){
      if(typeof options==='function'){callback=options;options={};}
      let pending=this.pending.get(index);
      if(!pending){pending=fetch('/fixture/pieces/'+hash+'/'+index).then(async response=>{if(!response.ok)throw Error('Fixture piece unavailable');return new Uint8Array(await response.arrayBuffer());});this.pending.set(index,pending);pending.finally(()=>this.pending.delete(index)).catch(()=>{});}
      pending.then(bytes=>callback(null,bytes.subarray(options.offset||0,(options.offset||0)+(options.length??bytes.length))),callback);
     }
     put(index,bytes,callback){callback?.();}
     close(callback){callback?.();}
     destroy(callback){callback?.();}
    }
    await new Promise((resolve,reject)=>{const torrent=seeder.add(new Uint8Array(metadata),{announce:[tracker],store:Store,storeCacheSlots:0,skipVerify:true},resolve);torrent.once('error',reject);});
   };
  });
  for(const hash of this.objects.keys())await this.seed(hash);
 }
 async close(){await this.browser?.close();if(this.tracker)await new Promise(resolve=>this.tracker.close(resolve));}
 async seed(hash){if(this.page)await this.page.evaluate(input=>seedObject(input),{metadata:[...this.objects.get(hash).metadata],hash,tracker:this.trackerURL});}
 async add(input,name) {
  const bytes=typeof input==='string'?await readFile(input):Buffer.from(input),size=bytes.length,pieces=[];
  for(let offset=0;offset<size;offset+=262144)pieces.push(sha1(bytes.subarray(offset,offset+262144)));
  const info={name,length:size,'piece length':262144,pieces:Buffer.concat(pieces)},hash=sha1(encode(info)).toString('hex');
  this.objects.set(hash,{bytes,name,size,info:encode(info),metadata:encode({info})});await this.seed(hash);return hash;
 }
 async publish(disk,state,profile) {
  const components=[['disk.torrent',disk],...(state?[['state.torrent',state]]:[]),...(profile?[['profile.torrent',profile]]:[])];
  const payload=Buffer.concat(components.map(([,hash])=>this.objects.get(hash).metadata));
  const files=components.map(([name,hash])=>{const bytes=this.objects.get(hash).metadata;return {path:[name],length:bytes.length,sha1:sha1(bytes)};});
  const pieces=[];for(let offset=0;offset<payload.length;offset+=262144)pieces.push(sha1(payload.subarray(offset,offset+262144)));
  const info={name:'my98',bep49:{'bep46 source':'magnet:?xs=urn:btpk:'+publicKey+'&s='+salt.toString('hex')},files,'piece length':262144,pieces:Buffer.concat(pieces)};
  this.descriptor=sha1(encode(info)).toString('hex');
  this.objects.set(this.descriptor,{name:'my98',bytes:payload,size:payload.length,info:encode(info),metadata:encode({info})});await this.seed(this.descriptor);
  const sequence=String(++this.sequence),value=encode({ih:Buffer.from(this.descriptor,'hex')});
  const message=Buffer.concat([Buffer.from('4:salt19:'),salt,Buffer.from('3:seqi'+sequence+'e1:v'),value]);
  this.record={key:publicKey,sequence,value:value.toString('hex'),signature:sign(null,message,key).toString('hex'),salt:salt.toString('hex')};
  return this.descriptor;
 }
 sources(url){return {gateways:[url],trackers:[this.trackerURL]};}
 async handle(req,res,url) {
  const path=url.pathname;
  if(path==='/fixture/seeder.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Disposable WebRTC seeder</title>');return true;}
  if(path==='/dht/mutable/'+publicKey){
   res.setHeader('Cache-Control','no-store');
   if(this.mode==='offline'){res.writeHead(503).end();return true;}
   const record={...this.record};if(this.mode==='bad-signature')record.signature='00'.repeat(64);
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(record));return true;
  }
  const piece=path.match(/^\/fixture\/pieces\/([a-f0-9]{40})\/(\d+)$/);
  if(piece){
   const object=this.objects.get(piece[1]);if(!object){res.writeHead(404).end();return true;}
   const first=+piece[2]*262144,last=Math.min(first+262143,object.size-1);
   req.headers.range=`bytes=${first}-${last}`;
   const virtual=new URL(url);virtual.pathname='/fixture/content/'+piece[1]+'/'+object.name;
   if(object.name==='profile.json')virtual.pathname='/fixture/metadata/'+piece[1];
   return this.handle(req,res,virtual);
  }
  const content=path.match(/^\/fixture\/(?:content|metadata)\/([a-f0-9]{40})(?:\/[^/]+)?$/),object=this.objects.get(content?.[1]);
  if(object){
   if(this.beforeRequest&&await this.beforeRequest({req,res,url}))return true;
   const range=req.headers.range?.match(/^bytes=(\d+)-(\d+)$/),first=+range[1],last=+range[2];
   this.requests.push({hash:content[1],first,last});
   let bytes=object.bytes.subarray(first,last+1);
   if(this.contentResponse)bytes=await this.contentResponse({hash:content[1],first,last,bytes});
   if(!res.destroyed)res.writeHead(200,{'Content-Length':bytes.length}).end(bytes);return true;
  }
  return false;
 }
}
