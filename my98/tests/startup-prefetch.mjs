import assert from 'node:assert/strict';
import {chromium,webkit} from '../my98/node_modules/playwright/index.mjs';

const until=async(predicate,message)=>{
 const deadline=Date.now()+20000;
 while(!predicate()) {if(Date.now()>deadline)throw Error(message);await new Promise(resolve=>setTimeout(resolve,10));}
};

// Signed publications, actual Worker and transport; no interception of emulator modules.
export async function checkStartupPrefetch({server,torrent,state,diskHash,profileHash,profile,results}) {
 const targets=new Set(),piece=262144,diskSize=torrent.objects.get(diskHash).size;
 for(const [first,last] of profile.ranges.filter(Boolean)) {
  const begin=198+first*65598,end=Math.min(diskSize,198+(last+1)*65598);
  for(let index=Math.floor(begin/piece);index<=Math.floor((end-1)/piece);index++)targets.add(index);
 }
 for(const [engine,type] of Object.entries({chromium,webkit})) {
  const browser=await type.launch();
  try {
   for(const mode of ['held-profile','transient-profile','failed-profile','profile-deadline','held-pieces','profile-first','cancel-reload']) {
    console.log('Startup prefetch',engine,mode);
    const context=await browser.newContext(),page=await context.newPage(),held=[],errors=[];
    page.on('pageerror',error=>errors.push(String(error)));
    await context.addInitScript(()=>{window.unhandled=[];addEventListener('unhandledrejection',event=>unhandled.push(String(event.reason)));});
    let queries=0;
    async function release() {
     torrent.beforeRequest=undefined;
     for(const {req,res,url} of held.splice(0))if(!res.destroyed)await torrent.handle(req,res,url);
    }
    async function start(budget) {
     await page.goto(server.url+'/owner.html');await page.waitForFunction(()=>window.module);
     await page.evaluate(async budget=>{
      const runtime=await module.loadRuntime(new AbortController().signal),create=runtime.Slop86Disk.create;
      window.progressEvents=[];window.messages=[];
      runtime.Slop86Disk.create=options=>{window.emitProgress=options.onProgress;return create.call(runtime.Slop86Disk,{...options,onProgress:event=>{
       options.onProgress(event);progressEvents.push({...event,at:performance.now(),text:document.querySelector('#status').textContent});
      }});};
      window.session=new module.FutureSession();
      if(budget!==undefined)session.prefetchPolicy.postRestoreBudgetMs=budget;
      const status=session.status;
      session.status=function(text,error){messages.push({text,error:!!error});return status.call(this,text,error);};
      session.runtime=runtime;session.runtimePromise=Promise.resolve(runtime);session.ready=session.load();
     },budget);
    }
    async function restored() {
     await page.waitForFunction(()=>session.attempt?.metrics.restored!==undefined,undefined,{timeout:20000});
    }
    async function finish(outcome) {
     await page.waitForFunction(()=>!session.working,undefined,{timeout:25000});
     assert.equal(await page.locator('#display').isVisible(),true,await page.locator('#status').textContent());
     assert.equal(await page.locator('#retry').isVisible(),false);
     const metrics=await page.evaluate(()=>session.attempt.metrics);
     assert.equal(metrics.prefetch.outcome,outcome);
     assert(metrics.prefetchFinished>=metrics.restored);
     assert(metrics.visible>=metrics.prefetchFinished);
     assert.equal(await page.evaluate(()=>session.machine.is_running()),true);
     assert.equal(await page.evaluate(()=>session.machine.v86.cpu.mem8[0x70000]),41);
     return metrics;
    }
    async function demand() {
     assert.equal(await page.evaluate(async()=>(await session.disk.read(10000,1))[0]),42);
     const length=await page.evaluate(async()=>{const description=await session.disk.describe();return (await session.disk.read(description.size-512,512)).length;});
     assert.equal(length,512,'Fallback must leave an operable disk');
    }
    try {
     await torrent.publish(diskHash,state,profileHash);
     torrent.beforeRequest=async value=>{
      const {req,res,url}=value,isProfile=url.pathname==='/v2/info/'+profileHash;
      if(isProfile)queries++;
      if(isProfile&&['held-profile','profile-deadline','cancel-reload'].includes(mode)) {held.push(value);return true;}
      if(isProfile&&(mode==='failed-profile'||mode==='transient-profile'&&queries<=2)) {res.writeHead(503).end();return true;}
      const range=req.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
      if(mode==='held-pieces'&&url.pathname.startsWith('/content/'+diskHash+'/')&&range&&+range[1]>0) {held.push(value);return true;}
      if(mode==='profile-first'&&url.pathname.startsWith('/content/'+state+'/')&&range) {held.push(value);return true;}
      return false;
     };
     await start(mode==='held-pieces'?650:undefined);
     if(mode==='held-profile'||mode==='cancel-reload') {
      await until(()=>held.length,'Profile metadata was never requested');await restored();
      assert.deepEqual(await page.evaluate(()=>({visible:!session.display.hidden,running:session.machine.is_running(),working:session.working})),{visible:false,running:false,working:true});
      assert.equal(await page.evaluate(()=>session.attempt.metrics.phases['download-state'].completed),torrent.objects.get(state).size,'State must finish while profile metadata is held');
      if(mode==='cancel-reload') {
       await page.evaluate(async()=>{window.previousProgress=emitProgress;await session.destroy();await session.ready;});
       await release();
       await page.evaluate(()=>{session=new module.FutureSession();session.ready=session.load();});
       await page.waitForFunction(()=>session.working&&session.disk);
       const before=await page.locator('#status').textContent();
       await page.evaluate(()=>previousProgress({phase:'download-startup',completed:1,total:2}));
       assert.equal(await page.locator('#status').textContent(),before);
      } else await release();
      await finish('complete');
     } else if(mode==='transient-profile'||mode==='failed-profile') {
      const metrics=await finish(mode==='transient-profile'?'complete':'fallback');
      assert.equal(metrics.prefetch.attempts,3);assert.equal(queries,3);
      await demand();
     } else if(mode==='profile-deadline') {
      await until(()=>held.length,'Profile metadata was never requested');await restored();
      assert.equal(await page.locator('#display').isVisible(),false);
      const metrics=await finish('fallback'),wait=metrics.prefetchFinished-metrics.restored;
      assert(wait>=9800&&wait<=12500,`Shared production deadline: ${wait} ms`);
      assert(metrics.prefetch.attempts<=3);
      await release();await demand();
      results.push({engine,startupPrefetch:'production-deadline',waitMs:wait,passed:true});
     } else if(mode==='held-pieces') {
      await until(()=>held.length,'No profile disk pieces were requested');await restored();
      assert.equal(await page.locator('#display').isVisible(),false);
      const metrics=await finish('fallback'),wait=metrics.prefetchFinished-metrics.restored;
      assert(wait>=500&&wait<=2500,`Short common deadline: ${wait} ms`);
      const events=await page.evaluate(()=>progressEvents.filter(event=>event.phase==='download-startup'));
      assert(events.length&&events.at(-1).completed<events.at(-1).total,'Fallback must not fabricate complete progress');
      assert(events.every(event=>event.total===events[0].total),'Fallback changed the denominator');
      await release();await demand();
      assert.equal(await page.evaluate(async()=>(await session.disk.readStats()).remote.scope),'none');
     } else if(mode==='profile-first') {
      await until(()=>held.length,'State was not requested');
      await page.waitForFunction(({diskHash,targets})=>{
       for(const transport of session.disk?.torrentHost.sessions.values()||[]) {
        const entry=transport.entries.get(diskHash);
        if(entry&&targets.every(index=>entry.torrent.bitfield.get(index)))return true;
       }
       return false;
      },{diskHash,targets:[...targets]},{timeout:15000});
      assert.equal(await page.locator('#display').isVisible(),false);
      assert.equal(await page.evaluate(()=>session.attempt.metrics.restored),undefined);
      await release();await finish('complete');
     }
     assert.deepEqual(await page.evaluate(()=>unhandled),[]);assert.deepEqual(errors,[]);
     results.push({engine,startupPrefetch:mode,passed:true});
    } finally {
     await release();
     await page.evaluate(()=>session?.destroy()).catch(()=>{});
     await context.close();
    }
   }
  } finally {await browser.close();}
 }
 torrent.beforeRequest=undefined;await torrent.publish(diskHash,state,profileHash);
}
