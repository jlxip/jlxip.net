import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {chromium,webkit} from '../../my98/node_modules/playwright/index.mjs';
const baseline=path.resolve(process.env.BASELINE_ROOT||'build/ans143/baseline');
const candidate=path.resolve(process.env.SITE_ROOT||'.');
const output=path.resolve(process.env.EVIDENCE||'build/ans143/performance');
const pairs=Number(process.env.PAIRS||5),controlled=process.env.CONTROLLED==='1';
const gateway=process.env.GATEWAY||'https://piensa.jlxip.net';
await mkdir(output,{recursive:true});
const config=JSON.parse(await readFile(path.join(candidate,'build/future/config.json')));
let record;
if(controlled) {
 const response=await fetch('https://piensa.jlxip.net/ipns/'+config.ipnsName+'?format=ipns-record',{headers:{Accept:'application/vnd.ipfs.ipns-record'}});
 assert(response.ok);record=Array.from(new Uint8Array(await response.arrayBuffer()));
}
async function serve(root) {
 // Historical comparison artifacts retain the previous entry point.
 const entry=existsSync(path.join(root,'future.html'))?'/future.html':'/index.html';
 const server=http.createServer(async(req,res)=>{
  try {
   const pathname=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+pathname);
   if(!file.startsWith(root+path.sep))throw Error('outside root');
   let bytes=await readFile(file);
   if(pathname===entry)bytes=Buffer.from(bytes.toString().replace('module => module.start()', 'module => {window.session=module.start();}'));
   if((gateway!=='auto'||process.env.TRACE==='1') && pathname.endsWith('/build/disk/web/client.js'))bytes=Buffer.from(bytes.toString()+`\nconst originalOpen=Slop86Disk.prototype.openReadOnly;Slop86Disk.prototype.openReadOnly=function(options){return originalOpen.call(this,{...options,${gateway!=='auto'?`gateway:${JSON.stringify(gateway)},`:''}${process.env.TRACE==='1'?'prefetch:{...options.prefetch,trace:true},':''}});};`);
   res.setHeader('Content-Type',file.endsWith('.html')?'text/html':/\.m?js$/.test(file)?'text/javascript':file.endsWith('.wasm')?'application/wasm':'application/octet-stream');
   res.setHeader('Cache-Control','no-store');res.end(bytes);
  }catch{res.writeHead(404).end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {url:'http://127.0.0.1:'+server.address().port,entry,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
const servers={before:await serve(baseline),after:await serve(candidate)},results=[];
try {
 for(const [engine,type] of Object.entries({chromium,webkit})) {
  if(process.env.ENGINE&&process.env.ENGINE!==engine)continue;
  const browser=await type.launch();
  try {for(let pair=0;pair<pairs;pair++)for(const version of pair%2?['after','before']:['before','after']) {
   const context=await browser.newContext({viewport:{width:1100,height:850}}),page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(String(error)));
   page.on('console',m=>{if(m.type()==='error')console.log(engine,version,m.text());});
   page.on('requestfailed',r=>console.log('request failed',r.url(),r.failure()?.errorText));
   if(controlled)await context.addInitScript(({record})=>{
    const original=fetch;globalThis.fetch=async(input,options)=>{
     const url=new URL(typeof input==='string'?input:input.url||input,location.href);
     if(url.pathname.includes('/ipns/')) {
      await new Promise((resolve,reject)=>{const t=setTimeout(resolve,url.hostname==='piensa.jlxip.net'?80:1800);options?.signal?.addEventListener('abort',()=>{clearTimeout(t);reject(new DOMException('Aborted','AbortError'));},{once:true});});
      return new Response(new Uint8Array(record),{headers:{'Content-Type':'application/vnd.ipfs.ipns-record'}});
     }
     return original(input,options);
    };
   },{record});
   try {
    const start=Date.now();await page.goto(servers[version].url+servers[version].entry);
    await page.waitForFunction(()=>window.session && (!session.display.hidden || (!session.working && !session.retry.hidden)),undefined,{timeout:180000});
    assert(await page.locator('#display').isVisible(),await page.locator('#status').textContent());
    const visibleMs=Date.now()-start;
    const initial=await page.evaluate(async()=>({publication:session.publication,stats:await session.disk.readStats(),description:await session.disk.describe(),timings:JSON.parse(JSON.stringify(session.timings,(key,value)=>['disk','controller'].includes(key)?undefined:value))}));
    if(process.env.TRACE==='1')initial.trace=await page.evaluate(()=>session.disk.readTrace());
    // A first action after the existing load profile completes must keep its benefit.
    await page.evaluate(async()=>{const deadline=performance.now()+90000;while(performance.now()<deadline){const s=await session.disk.readStats();if(s.remote.loadProfile.status==='complete')return;await new Promise(r=>setTimeout(r,40));}throw Error('Profile timeout');});
    await page.evaluate(()=>{window.opened=[];window.open=()=>({opener:null,location:{replace:url=>opened.push({url,time:performance.now()})}});});
    const rect=await page.locator('canvas').boundingBox(),before=await page.evaluate(()=>session.disk.readStats());
    const clickStart=await page.evaluate(()=>performance.now());
    await page.mouse.click(rect.x+50/800*rect.width,rect.y+359/600*rect.height,{delay:80});
    await page.waitForFunction(()=>opened.length===1,undefined,{timeout:30000});
    const action=await page.evaluate(async()=>({opened:opened[0],stats:await session.disk.readStats()}));
    assert.equal(action.opened.url,'https://jlxip.net/crypto101.html');assert.equal(action.stats.networkRequests-before.networkRequests,0);
    assert.deepEqual(errors,[]);
    const result={engine,pair,version,controlled,gateway,visibleMs,...initial,firstClickMs:action.opened.time-clickStart,clickNetworkRequests:action.stats.networkRequests-before.networkRequests,errors};
    results.push(result);console.log(JSON.stringify({engine,pair,version,visibleMs,timings:initial.timings,firstClickMs:result.firstClickMs}));
    if(pair===0&&version==='after')await page.screenshot({path:path.join(output,engine+'.png')});
    await page.evaluate(()=>session.destroy());
   }finally{await context.close();await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));}
  }}finally{await browser.close();}
 }
 const median=a=>{const s=a.toSorted((a,b)=>a-b);return s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2;};
 const summary={controlled,gateway,pairs,engines:{}};
 for(const engine of new Set(results.map(r=>r.engine))) {
  const group=results.filter(r=>r.engine===engine),roots=new Set(group.map(r=>r.description.remote.stateCid));assert.equal(roots.size,1);
  summary.engines[engine]={stateCid:[...roots][0]};
  for(const version of ['before','after']){const times=group.filter(r=>r.version===version).map(r=>r.visibleMs);summary.engines[engine][version]={median:median(times),min:Math.min(...times),max:Math.max(...times),count:times.length};}
  if(controlled)assert(summary.engines[engine].after.median<summary.engines[engine].before.median,'Controlled load must improve');
 }
 await writeFile(path.join(output,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}finally{await Promise.all(Object.values(servers).map(s=>s.close()));}
