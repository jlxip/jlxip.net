import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium,webkit} from '../my98/node_modules/playwright/index.mjs';
import {serveFuture} from './future-server.mjs';
const roots={before:path.resolve(process.env.BASELINE_ROOT||'build/ans143/baseline'),after:path.resolve(process.env.SITE_ROOT||'.')};
const output=path.resolve(process.env.EVIDENCE||'build/load-performance');await mkdir(output,{recursive:true});
const servers={},results=[],pairs=Number(process.env.PAIRS||5);
assert(Number.isInteger(pairs)&&pairs>0&&pairs<=100);
try {
 for(const [version,root] of Object.entries(roots)){
  const config=JSON.parse(await readFile(path.join(root,'build/future/config.json'),'utf8'));
  assert(!config.ipnsName,'Use two WebTorrent artifacts for a meaningful comparison');
  servers[version]=await serveFuture(root,true);
 }
 for(const [engine,type] of Object.entries({chromium,webkit})){
  if(process.env.ENGINE&&process.env.ENGINE!==engine)continue;
  const browser=await type.launch();try{
   for(let pair=0;pair<pairs;pair++)for(const version of pair%2?['after','before']:['before','after']){
    const context=await browser.newContext({viewport:{width:1100,height:850}});
    try{
     const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
     const start=Date.now();await page.goto(servers[version].url+'/');
     await page.waitForFunction(()=>window.session&&!session.working,undefined,{timeout:180000});
     assert(await page.locator('#display').isVisible(),await page.locator('#status').textContent());
     const visibleMs=Date.now()-start;
     await page.waitForFunction(()=>[...session.disk.torrentHost.sessions.values()].every(transport=>[...transport.entries.values()].every(entry=>!entry.prefetch)),undefined,{timeout:120000});
     await page.evaluate(()=>{window.opened=[];window.open=()=>({opener:null,location:{replace:url=>opened.push({url,time:performance.now()})}});});
     const rect=await page.locator('canvas').boundingBox(),clickStart=await page.evaluate(()=>performance.now());
     await page.mouse.click(rect.x+50/800*rect.width,rect.y+359/600*rect.height,{delay:80});
     await page.waitForFunction(()=>opened.length===1,undefined,{timeout:30000});
     const detail=await page.evaluate(()=>({publication:session.publication,timings:session.timings,action:opened[0]}));
     assert.equal(detail.action.url,'https://jlxip.net/crypto101.html');assert.deepEqual(errors,[]);
     results.push({engine,pair,version,visibleMs,firstClickMs:detail.action.time-clickStart,...detail});
     await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2)+'\n');
    }finally{await context.close();}
   }
  }finally{await browser.close();}
 }
 assert.equal(new Set(results.map(result=>result.publication.infoHash)).size,1,'Publications changed during comparison');
 const median=values=>{values.sort((a,b)=>a-b);return (values[Math.floor((values.length-1)/2)]+values[Math.floor(values.length/2)])/2;};
 const summary={};for(const engine of new Set(results.map(result=>result.engine))){summary[engine]={};for(const version of ['before','after']){
  const group=results.filter(result=>result.engine===engine&&result.version===version);
  summary[engine][version]={count:group.length,visibleMs:median(group.map(result=>result.visibleMs)),firstClickMs:median(group.map(result=>result.firstClickMs))};
 }}
 await writeFile(path.join(output,'summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(summary);
}finally{await Promise.all(Object.values(servers).map(server=>server.close()));}
