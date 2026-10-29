import assert from 'node:assert/strict';
import path from 'node:path';
import {chromium,webkit} from '../my98/node_modules/playwright/index.mjs';

// Exercise the real signed publication, Worker, verified pieces and persistent cache.
export async function checkDownloadProgress({server,torrent,state,stateBytes,diskHash,profile,output,results}) {
 const piece=262144,diskSize=torrent.objects.get(diskHash).size,targets=new Set();
 for(const [first,last] of profile.ranges.filter(Boolean)) {
  const begin=198+first*65598,end=Math.min(diskSize,198+(last+1)*65598);
  for(let index=Math.floor(begin/piece);index<=Math.floor((end-1)/piece);index++)targets.add(index);
 }
 const profileBytes=[...targets].reduce((sum,index)=>sum+Math.min(piece,diskSize-index*piece),0);
 const total=stateBytes.length+profileBytes;
 assert(stateBytes.length>4*piece&&stateBytes.length%piece!==0,'Fixture needs multiple pieces and a short last piece');
 for(const [engine,type] of Object.entries({chromium,webkit})) {
  const browser=await type.launch(),context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  let page;
  torrent.contentResponse=async value=>{
   if(value.hash!==state)return value.bytes;
   await new Promise(resolve=>setTimeout(resolve,300));
   return value.bytes;
  };
  async function start() {
   page=await context.newPage();
   page.on('console',message=>{if(message.type()==='error')console.error(message.text());});
   await page.goto(server.url+'/owner.html');
   await page.waitForFunction(()=>window.module);
   await page.evaluate(async()=>{
    const runtime=await module.loadRuntime(new AbortController().signal),create=runtime.Slop86Disk.create;
    window.progressEvents=[];window.messages=[];
    runtime.Slop86Disk.create=options=>{window.emitProgress=options.onProgress;return create.call(runtime.Slop86Disk,{...options,onProgress:p=>{
     options.onProgress(p);window.emitProgress=options.onProgress;
     progressEvents.push({...p,text:document.querySelector('#status').textContent});
    }});};
    const session=window.session=new module.FutureSession(),status=session.status;
    session.status=function(text,error){messages.push({text,error:!!error});return status.call(this,text,error);};
    const createMachine=session.createMachine;
    session.createMachine=function(...args){
     const before=document.querySelector('#status').textContent;
     if(!before.startsWith('Downloading...'))throw Error('Download counter disappeared during restoration');
     emitProgress({phase:'download-state',completed:1,total:2});
     if(document.querySelector('#status').textContent!==before)throw Error('State-only progress replaced the combined counter');
     return createMachine.apply(this,args);
    };
    session.runtime=runtime;session.runtimePromise=Promise.resolve(runtime);session.ready=session.load();
   });
  }
  async function finish() {
   await page.waitForFunction(()=>!session.working,undefined,{timeout:60000});
   assert.equal(await page.locator('#display').isVisible(),true,await page.locator('#status').textContent());
   const data=await page.evaluate(()=>({events:progressEvents.filter(p=>p.phase==='download-startup'),messages}));
   assert(data.events.length,'Missing combined startup progress');
   assert(data.messages.some(m=>m.text==='Getting ready...'),'Missing preparation phase');
   assert(!data.messages.some(m=>m.text==='Downloading...'),'Download label requires a counter');
   let previous=0;
   for(const event of data.events) {
    assert.equal(event.total,total);assert(event.completed>=previous&&event.completed<=total);
    assert.equal(event.text,`Downloading...\n${(event.completed/1048576).toFixed(1)} / ${(total/1048576).toFixed(1)} MiB`);
    previous=event.completed;
   }
   assert.equal(previous,total,'Last verified snapshot must reach the exact total');
   const almost=data.messages.findIndex(m=>m.text==='Almost there…');assert(almost>=0);
   assert(!data.messages.slice(almost+1).some(m=>m.text.startsWith('Downloading')));
   await page.evaluate(total=>emitProgress({phase:'download-startup',completed:total,total}),total);
   assert.equal(await page.locator('#loading').isVisible(),false,'Late progress must not reopen the panel');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   return data;
  }
  async function close() {await page.evaluate(()=>session.destroy());await page.close();}
  async function editCache(mode,hash=state,index) {
   await page.evaluate(async({hash,mode,index})=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('my98-torrents-v1',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    try {await new Promise((resolve,reject)=>{
     const tx=db.transaction('pieces','readwrite'),store=tx.objectStore('pieces');
     tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
     const r=store.index('hash').openCursor(IDBKeyRange.only(hash));
     r.onsuccess=()=>{const cursor=r.result;if(!cursor)return;
      if(mode==='partial'&&cursor.value.index>=2)cursor.delete();
      if(mode==='missing'&&cursor.value.index===index)cursor.delete();
      if(mode==='corrupt'&&cursor.value.index===(index??0)){const row=cursor.value;row.data[0]^=1;cursor.update(row);}
      cursor.continue();
     };
    });}finally{db.close();}
   },{hash,mode,index});
  }
  try {
   console.log('Download progress',engine,'cold');await start();
   await page.waitForFunction(()=>progressEvents.some(p=>p.phase==='download-startup'&&p.completed>0&&p.completed<p.total));
   const lines=await page.locator('#status').evaluate(element=>{
    const text=element.firstChild,split=text.textContent.indexOf('\n'),range=document.createRange();
    range.setStart(text,0);range.setEnd(text,split);const heading=range.getBoundingClientRect();
    range.setStart(text,split+1);range.setEnd(text,text.length);const counter=range.getBoundingClientRect();
    return {headingBottom:heading.bottom,counterTop:counter.top,whiteSpace:getComputedStyle(element).whiteSpace};
   });
   assert.equal(lines.whiteSpace,'pre-line');assert(lines.counterTop>=lines.headingBottom,'Counter must render below Downloading');
   await page.screenshot({path:path.join(output,`download-${engine}-mobile.png`)});
   await page.setViewportSize({width:1100,height:850});
   await page.screenshot({path:path.join(output,`download-${engine}-desktop.png`)});
   const cold=await finish();results.push({engine,downloadProgress:'cold',total,events:cold.events.length,passed:true});
   await close();

   console.log('Download progress',engine,'warm');const before=torrent.requests.length;
   await start();await finish();
   assert.equal(torrent.requests.slice(before).filter(r=>r.hash===state||r.hash===diskHash).length,0,'Warm state and profile must use verified cache');
   results.push({engine,downloadProgress:'warm',passed:true});
   await page.evaluate(()=>session.destroy());await editCache('partial');await page.close();

   console.log('Download progress',engine,'partial');const partialStart=torrent.requests.length;
   await start();const partial=await finish();
   assert(partial.events.some(p=>p.completed>=2*piece&&p.completed<total));
   const fetched=torrent.requests.slice(partialStart).filter(r=>r.hash===state);assert(fetched.length);
   assert(fetched.every(r=>r.first>=2*piece),'Verified cached pieces must not be downloaded again');
   results.push({engine,downloadProgress:'partial',passed:true});
   await page.evaluate(()=>session.destroy());await editCache('corrupt');await page.close();

   console.log('Download progress',engine,'corrupt-cache');const corruptStart=torrent.requests.length;
   await start();await finish();
   assert(torrent.requests.slice(corruptStart).some(r=>r.hash===state&&r.first===0),'Corrupt piece must be rejected and downloaded again');
   results.push({engine,downloadProgress:'corrupt-cache',passed:true});
   await page.evaluate(()=>session.destroy());await editCache('partial');await page.close();

   // Targeted profile cache recovery must not fetch any already verified neighbour.
   const target=[...targets].sort((a,b)=>a-b).at(-1);
   for(const mode of ['missing','corrupt']) {
    await start();await finish();await page.evaluate(()=>session.destroy());
    await editCache(mode,diskHash,target);await page.close();
    const beforeDisk=torrent.requests.length;await start();await finish();
    const requested=torrent.requests.slice(beforeDisk).filter(r=>r.hash===diskHash);
    assert(requested.some(r=>r.first===target*piece),'Missing/corrupt profile piece was not downloaded');
    assert(requested.every(r=>r.first===target*piece),'Verified profile neighbours were downloaded again: '+JSON.stringify({mode,target,requested}));
    results.push({engine,downloadProgress:'profile-'+mode,passed:true});await close();
   }

   console.log('Download progress',engine,'error-retry');await start();
   await page.waitForFunction(()=>session.disk?.pending.size>0);
   // Exercise the actual Worker-failure/retry path while a load is pending.
   await page.evaluate(()=>session.disk.fail(new Error('Fixture Worker failure')));
   await page.waitForFunction(()=>!session.working,undefined,{timeout:60000});
   assert.equal(await page.locator('#retry').isVisible(),true);
   await page.evaluate(()=>emitProgress?.({phase:'download-startup',completed:1,total:2}));
   assert.match(await page.locator('#status').textContent(),/failed\.\nError: Fixture Worker failure/);
   await page.evaluate(()=>{progressEvents=[];messages=[];});await page.locator('#retry').click();await finish();
   results.push({engine,downloadProgress:'error-retry',passed:true});
   await page.evaluate(()=>session.destroy());await editCache('partial');await page.close();

   // A cancelled attempt cannot affect a subsequent session in the same page.
   await start();await page.waitForFunction(()=>window.emitProgress&&session.disk?.pending.size>0);
   await page.evaluate(async()=>{
    const old=window.emitProgress;await session.destroy();
    await session.ready;
    window.previousProgress=old;progressEvents=[];messages=[];
    session=new module.FutureSession();session.ready=session.load();
   });
   await page.waitForFunction(()=>session.working&&session.disk);
   const message=await page.locator('#status').textContent();
   await page.evaluate(()=>previousProgress({phase:'download-startup',completed:2,total:2}));
   assert.equal(await page.locator('#status').textContent(),message,'Old callback changed a new attempt');
   await page.waitForFunction(()=>!session.working,undefined,{timeout:60000});
   await page.evaluate(()=>previousProgress?.({phase:'download-startup',completed:2,total:2}));
   assert.equal(await page.locator('#display').isVisible(),true);assert.equal(await page.locator('#loading').isVisible(),false);
   results.push({engine,downloadProgress:'cancel-reload',passed:true});await close();
  }finally{torrent.contentResponse=undefined;await context.close();await browser.close();}
 }
}
