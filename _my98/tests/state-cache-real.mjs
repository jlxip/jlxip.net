// Real published bytes over a local gateway with fixed latency; never publishes.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {mkdir,readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {chromium,webkit} from '../../my98/node_modules/playwright/index.mjs';
import {CID} from '../../my98/node_modules/multiformats/dist/src/cid.js';
import {sha256} from '../../my98/node_modules/multiformats/dist/src/hashes/sha2.js';
import {decode} from '../../my98/node_modules/@ipld/dag-pb/src/index.js';
import {UnixFS} from '../../my98/node_modules/ipfs-unixfs/dist/src/index.js';
import {carBytes} from '../../my98/src/disk/scripts/car-fixture.mjs';
const root=path.resolve(process.env.SITE_ROOT||'.'),out=path.resolve(process.env.EVIDENCE||'build/state-cache/real'),data=path.resolve(process.env.CACHE_BLOCKS||'build/state-cache/data');
await mkdir(out,{recursive:true});await mkdir(data,{recursive:true});
const config=JSON.parse(await readFile(path.join(root,'build/future/config.json'))),upstream=process.env.FIXTURE_GATEWAY||'https://oregon.jlxip.net';
const ipns=await fetch((process.env.FIXTURE_RESOLVER||'https://piensa.jlxip.net')+'/ipns/'+config.ipnsName+'?format=ipns-record',{headers:{Accept:'application/vnd.ipfs.ipns-record'},signal:AbortSignal.timeout(30000)});assert(ipns.ok);const record=Buffer.from(await ipns.arrayBuffer());await writeFile(out+'/ipns-record.bin',record);
const blocks=new Map(),loads=new Map();let frozen=false,requests=[];
async function block(cid){
 if(blocks.has(cid))return blocks.get(cid);
 if(loads.has(cid))return loads.get(cid);
 const job=(async()=>{let bytes;try{bytes=await readFile(path.join(data,cid));}catch{assert(!frozen,'Unexpected fixture miss '+cid);const r=await fetch(upstream+'/ipfs/'+cid+'?format=raw',{signal:AbortSignal.timeout(30000)});assert(r.ok,'Fixture download '+r.status);bytes=Buffer.from(await r.arrayBuffer());await writeFile(path.join(data,cid),bytes);}
 const parsed=CID.parse(cid),hash=await sha256.digest(bytes);assert.deepEqual(hash.digest,parsed.multihash.digest);blocks.set(cid,bytes);return bytes;})();loads.set(cid,job);try{return await job;}finally{loads.delete(cid);}
}
async function tree(cid){const bytes=await block(cid);if(CID.parse(cid).code===0x70)for(const l of decode(bytes).Links)await tree(l.Hash.toString());}
let servedState;
const timers=new Set();
const gateway=http.createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Accept');if(req.method==='OPTIONS'){res.end();return;}
 const u=new URL(req.url,'http://localhost');requests.push(u.pathname+u.search);
 try{
  if(u.pathname.includes('/ipns/')){res.setHeader('Content-Type','application/vnd.ipfs.ipns-record');res.end(record);return;}
  const cid=u.pathname.slice(6);assert(u.pathname.startsWith('/ipfs/'));let bytes=await block(cid),type='application/vnd.ipld.raw';
  if(u.searchParams.get('format')==='car'){await tree(cid);const [first,last]=u.searchParams.get('entity-bytes').split(':').map(Number);bytes=Buffer.from(carBytes(blocks,CID.parse(cid),first,last-first+1));type='application/vnd.ipld.car';}
  res.setHeader('Content-Type',type);res.setHeader('Content-Length',bytes.length);let offset=0;
  const send=()=>{if(res.destroyed)return;if(offset===bytes.length){res.end();return;}const end=Math.min(bytes.length,offset+65536);res.write(bytes.subarray(offset,end));offset=end;const t=setTimeout(()=>{timers.delete(t);send();},32);timers.add(t);};
  const t=setTimeout(()=>{timers.delete(t);send();},80);timers.add(t);
 }catch(error){console.log('fixture error',error.message);res.writeHead(404).end();}
});await new Promise(r=>gateway.listen(0,'127.0.0.1',r));const gatewayURL='http://127.0.0.1:'+gateway.address().port;
const server=http.createServer(async(req,res)=>{
 try{const pathname=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+pathname);assert(file.startsWith(root+path.sep));let bytes=await readFile(file);
 if(pathname==='/index.html')bytes=Buffer.from(bytes.toString().replace('module => module.start()','module => {window.session=module.start();}'));
 if(pathname.endsWith('/build/disk/web/client.js'))bytes=Buffer.from(bytes.toString()+`\nconst openOriginal=Slop86Disk.prototype.openReadOnly;Slop86Disk.prototype.openReadOnly=function(options){return openOriginal.call(this,{...options,gateway:${JSON.stringify(gatewayURL)},persistentCache:{state:globalThis.cacheEnabled,loadProfile:globalThis.cacheEnabled}});};`);
 res.setHeader('Content-Type',file.endsWith('.html')?'text/html':/\.m?js$/.test(file)?'text/javascript':file.endsWith('.wasm')?'application/wasm':'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(bytes);
 }catch{res.writeHead(404).end();}
});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port,results=[];
const median=a=>a.toSorted((a,b)=>a-b)[Math.floor(a.length/2)];
async function setup(context,enabled){await context.addInitScript(({enabled,gatewayURL})=>{globalThis.cacheEnabled=enabled;const original=fetch;globalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'?input:input.url||input,location.href);if(u.pathname.includes('/ipns/'))return original(gatewayURL+u.pathname+u.search,options);return original(input,options);};},{enabled,gatewayURL});}
async function load(context,label,engine,pair){
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));const requestStart=requests.length,start=Date.now();
 try{
  await page.goto(url+'/index.html');await page.waitForFunction(()=>window.session&&(!session.display.hidden||(!session.working&&!session.retry.hidden)),undefined,{timeout:120000});assert(await page.locator('#display').isVisible(),await page.locator('#status').textContent());const visibleMs=Date.now()-start;
  await page.evaluate(async()=>{const end=Date.now()+120000;while(Date.now()<end){const r=(await session.disk.readStats()).remote;if(r.loadProfile?.status==='complete'&&r.prefetchState==='complete'&&!r.persistentCache.pendingWrites)return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Profile did not settle');});const profileMs=Date.now()-start;
  const info=await page.evaluate(async()=>({stats:await session.disk.readStats(),description:await session.disk.describe(),publication:session.publication}));servedState=info.description.remote.stateCid;
  await page.evaluate(()=>{window.opened=[];window.open=()=>({opener:null,location:{replace(url){opened.push(url);}}});});
  const before=(await page.evaluate(()=>session.disk.readStats())).networkRequests;
  const rect=await page.locator('canvas').boundingBox();await page.mouse.click(rect.x+24/800*rect.width,rect.y+359/600*rect.height,{delay:80});await page.waitForFunction(()=>opened.length===1,undefined,{timeout:15000});assert.equal(await page.evaluate(()=>opened[0]),'https://jlxip.net/crypto101.html');
  if((await page.evaluate(()=>session.disk.readStats())).networkRequests!==before){await writeFile(out+'/click-failure.json',JSON.stringify({info,after:await page.evaluate(()=>session.disk.readStats()),requests:requests.slice(requestStart)},null,2));}assert.equal((await page.evaluate(()=>session.disk.readStats())).networkRequests,before);assert.deepEqual(errors,[]);
  if(label==='warm'&&pair===0){
   await page.waitForTimeout(1000); // Guest completes OPEN through its timer before another click.
   for(const [y,target] of [[231,'https://my98.lol/'],[263,'https://jlxip.github.io/ecdh'],[295,'https://youtube.com/jlxip'],[327,'https://jlxip.net/TFG.pdf'],[391,'https://github.com/jlxip']]){
    const count=await page.evaluate(()=>opened.length);await page.mouse.click(rect.x+24/800*rect.width,rect.y+y/600*rect.height,{delay:80});await page.waitForFunction(n=>opened.length===n+1,count,{timeout:15000});assert.equal(await page.evaluate(()=>opened.at(-1)),target);await page.waitForTimeout(1000);
   }
   assert.equal((await page.evaluate(()=>session.disk.readStats())).networkRequests,before,'all six profile links use cached disk blocks');
  }
  const measured=requests.slice(requestStart),stateCids=new Set();async function members(cid){if(stateCids.has(cid))return;stateCids.add(cid);const bytes=await block(cid);if(CID.parse(cid).code===0x70)for(const l of decode(bytes).Links)await members(l.Hash.toString());}await members(servedState);
  const stateRequests=measured.filter(r=>stateCids.has(new URL(r,gatewayURL).pathname.slice(6)));
  const result={engine,label,pair,visibleMs,profileMs,stateRequests:stateRequests.length,requests:measured,...info,errors};results.push(result);console.log(JSON.stringify({engine,label,pair,visibleMs,profileMs,stateRequests:stateRequests.length,cache:info.stats.remote.persistentCache}));
  if(label==='warm'||label==='restart')assert.equal(stateRequests.length,0,'warm state must not download');
  if(pair===0&&label==='warm')await page.screenshot({path:out+'/'+engine+'-warm.png'});
  await page.evaluate(()=>session.destroy());return result;
 }finally{await page.close();await writeFile(out+'/results.json',JSON.stringify(results,null,2));}
}
try{
 for(const [engine,type] of Object.entries({chromium,webkit})){
  if(process.env.ENGINE&&process.env.ENGINE!==engine)continue;
  const browser=await type.launch();try{
   if(!frozen){const context=await browser.newContext();await setup(context,false);await load(context,'fixture-preparation',engine,-1);await context.close();frozen=true;}
   for(let pair=0;pair<Number(process.env.PAIRS||5);pair++){
    for(const mode of pair%2?['cached','disabled']:['disabled','cached']){
     const context=await browser.newContext({viewport:{width:1100,height:850}});await setup(context,mode==='cached');
     try{await load(context,mode==='cached'?'cold':'disabled',engine,pair);if(mode==='cached')await load(context,'warm',engine,pair);}finally{await context.close();}
    }
   }
  }finally{await browser.close();}
  const dir=await mkdtemp(out+'/profile-');let context;
  try{context=await type.launchPersistentContext(dir,{headless:true});await setup(context,true);await load(context,'persistent-cold',engine,-1);await context.close();context=await type.launchPersistentContext(dir,{headless:true});await setup(context,true);await load(context,'restart',engine,-1);}finally{await context?.close();await rm(dir,{recursive:true,force:true});}
 }
 const summary={network:{latencyMs:80,chunkBytes:65536,chunkIntervalMs:32},engines:{}};
 for(const engine of new Set(results.map(r=>r.engine))){const values=Object.fromEntries(['disabled','cold','warm'].map(label=>[label,results.filter(r=>r.engine===engine&&r.label===label)]));const stats=Object.fromEntries(Object.entries(values).map(([label,rows])=>[label,{visibleMs:median(rows.map(r=>r.visibleMs)),profileMs:median(rows.map(r=>r.profileMs)),count:rows.length}]));summary.engines[engine]=stats;}
 await writeFile(out+'/summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
 for(const stats of Object.values(summary.engines)){assert(stats.warm.visibleMs<stats.cold.visibleMs,'warm median must improve');assert(stats.cold.visibleMs<=stats.disabled.visibleMs*1.1,'cold cache overhead exceeds 10%');}
}finally{for(const t of timers)clearTimeout(t);server.closeAllConnections();gateway.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>gateway.close(r))]);}
