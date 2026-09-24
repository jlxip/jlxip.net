// Existing public state, immutable disk/state CIDs, locally supplied profile root.
// No signing key, IPNS write or real popup is used by this acceptance test.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium,webkit} from '../../my98/node_modules/playwright/index.mjs';
import {CID} from '../../my98/node_modules/multiformats/dist/src/cid.js';
import {sha256} from '../../my98/node_modules/multiformats/dist/src/hashes/sha2.js';
import * as dagPB from '../../my98/node_modules/@ipld/dag-pb/src/index.js';
import {UnixFS} from '../../my98/node_modules/ipfs-unixfs/dist/src/index.js';
import {serveFuture} from './future-server.mjs';

const output=path.resolve(process.env.EVIDENCE||'build/load-profile-real');await mkdir(output,{recursive:true});
const server=await serveFuture(process.env.SITE_ROOT||process.cwd(),true),results=[];
let wrapper,profileBytes,wrapperCid,profileCid,profile,base;
if(process.env.PROFILE_ONLY || process.env.EARLY_ONLY) {
 [profile]=JSON.parse(await readFile(path.join(output,'load-profiles.json')));profileBytes=Buffer.from(JSON.stringify([profile]));profileCid=CID.createV1(0x55,await sha256.digest(profileBytes)).toString();
 wrapper=await readFile(path.join(output,'publication.pb'));wrapperCid=CID.createV1(0x70,await sha256.digest(wrapper)).toString();
 base={cid:profile.cid,stateCid:dagPB.decode(wrapper).Links.find(l=>l.Name==='state.my98state').Hash.toString()};
}
try {
 for(const [engine,type] of Object.entries({chromium,webkit})) {
  const browser=await type.launch();
  try {
   for(const mode of (process.env.EARLY_ONLY?['early']:process.env.PROFILE_ONLY?['profile']:engine==='chromium'?['record','cold','early','profile']:['cold','early','profile'])) {
    const withProfile=mode==='profile' || mode==='early';
    const context=await browser.newContext({viewport:{width:1100,height:850}}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(String(e)));
    // WebKit's blob-worker loading races immediate revocation with HTTP interception.
    await context.addInitScript(()=>{const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>setTimeout(()=>revoke(url),1000);});
    try {
     await context.route('**/build/disk/web/client.js',async route=>{
      const response=await route.fetch();
      const patch=`\nconst openForTest=Slop86Disk.prototype.openReadOnly, prefetchForTest=Slop86Disk.prototype.setLoadPrefetch;
Slop86Disk.prototype.openReadOnly=function(options){return openForTest.call(this,{...options,cid:${JSON.stringify(withProfile?wrapperCid:null)}||options.cid,gateway:'https://piensa.jlxip.net',prefetch:{enabled:false,trace:true}});};
Slop86Disk.prototype.setLoadPrefetch=async function(options){if(options.origin==='restored' && options.scope==='profile'){
 if(${JSON.stringify(mode)}==='record')await this.startLoadAnalysis({origin:'restored'});
 if(!${withProfile})options={...options,scope:'none'};
}return prefetchForTest.call(this,options);};`;
      await route.fulfill({response,body:await response.text()+patch});
     });
     if(withProfile)await context.route('https://piensa.jlxip.net/ipfs/**',async route=>{
      const cid=new URL(route.request().url()).pathname.slice(6);
      if(cid!==wrapperCid && cid!==profileCid)return route.continue();
      await route.fulfill({status:200,contentType:'application/vnd.ipld.raw',headers:{'Access-Control-Allow-Origin':'*'},body:cid===wrapperCid?wrapper:profileBytes});
     });
     const start=Date.now();await page.goto(server.url+'/future.html');
     await page.waitForFunction(()=>window.session&&!session.working,undefined,{timeout:180000});
     assert(await page.locator('#display').isVisible(),await page.locator('#status').textContent());
     const visibleMs=Date.now()-start,initial=await page.evaluate(()=>session.disk.readStats());
     const description=await page.evaluate(()=>session.disk.describe());
     if(base) {assert.equal(description.remote.cid,base.cid);assert.equal(description.remote.stateCid,base.stateCid);}
     else base={cid:description.remote.cid,stateCid:description.remote.stateCid};
     if(withProfile) {
      assert.equal(initial.remote.loadProfile.scope,'profile');
      // The homepage is interactive while the profile is still being fetched.
      assert.notEqual(initial.remote.loadProfile.status,'complete');
      if(mode==='profile')await page.evaluate(async()=>{const until=performance.now()+120000;while(performance.now()<until){const r=(await session.disk.readStats()).remote;if(r.loadProfile?.status==='complete' && r.prefetchState==='complete')return;await new Promise(r=>setTimeout(r,50));}throw Error('Profile did not complete');});
     }
     const readyMs=Date.now()-start,ready=await page.evaluate(()=>session.disk.readStats());
     if(mode==='profile')assert(ready.remote.completedUnits<ready.remote.totalUnits);
     await page.evaluate(()=>{
      window.measure={opens:[],input:[],codes:[]};
      document.addEventListener('pointerup',()=>measure.input.push(performance.now()),true);
      window.open=()=>{const tab={opener:window,location:{replace(url){measure.opens.push({time:performance.now(),url,openerNull:tab.opener===null});}}};return tab;};
      const send=session.machine.keyboard_send_scancodes.bind(session.machine);session.machine.keyboard_send_scancodes=c=>{measure.codes.push(c);return send(c);};
     });
     async function click(x,y){const r=await page.locator('canvas').boundingBox();await page.mouse.click(r.x+x/800*r.width,r.y+y/600*r.height,{delay:80});}
     const before=await page.evaluate(()=>session.disk.readStats());
     if(mode==='early')assert.notEqual(before.remote.loadProfile.status,'complete','click precedes completed profile');
     await click(50,359);
     await page.waitForFunction(()=>measure.opens.length===1,undefined,{timeout:60000});
     const clickResult=await page.evaluate(async before=>({elapsedMs:measure.opens[0].time-measure.input[0],open:measure.opens[0],before,after:await session.disk.readStats()}),before);
     assert.equal(clickResult.open.url,'https://jlxip.net/crypto101.html');assert.equal(clickResult.open.openerNull,true);
     const networkRequests=clickResult.after.networkRequests-before.networkRequests,networkBytes=clickResult.after.networkBytes-before.networkBytes;
     await writeFile(path.join(output,`${engine}-${mode}-trace.json`),JSON.stringify({initial,ready,clickResult,trace:await page.evaluate(()=>session.disk.readTrace())},null,2));
     if(mode==='profile')assert.equal(networkRequests,0,'covered first click must not fetch disk data');
     if(mode==='record') {
      [profile]=await page.evaluate(()=>session.disk.finishLoadAnalysis());assert.equal(profile.version,2);assert.equal(profile.cid,base.cid);
      profileBytes=Buffer.from(JSON.stringify([profile]));profileCid=CID.createV1(0x55,await sha256.digest(profileBytes)).toString();
      wrapper=Buffer.from(dagPB.encode(dagPB.prepare({Data:new UnixFS({type:'directory'}).marshal(),Links:[
       {Name:'disk.my98',Hash:CID.parse(base.cid),Tsize:0}, {Name:'state.my98state',Hash:CID.parse(base.stateCid),Tsize:0},
       {Name:'load-profiles.json',Hash:CID.parse(profileCid),Tsize:profileBytes.length},
      ]})));wrapperCid=CID.createV1(0x70,await sha256.digest(wrapper)).toString();
      await writeFile(path.join(output,'load-profiles.json'),profileBytes);
      await writeFile(path.join(output,'publication.pb'),wrapper);
     }
     await page.screenshot({path:path.join(output,`${engine}-${mode}.png`)});
     let exit;
     if(withProfile) {
      await page.waitForTimeout(4500);await click(80,420);await page.waitForFunction(()=>session.bridge.exited,undefined,{timeout:30000});
      await page.evaluate(async()=>{for(let i=0;i<100;i++){if((await session.disk.readStats()).remote.loadProfile.scope==='disk')return;await new Promise(r=>setTimeout(r,10));}throw Error('Exit did not extend scope');});
      exit=await page.evaluate(async()=>({stats:await session.disk.readStats(),keyboard:session.machine.keyboard_adapter.emu_enabled,pointer:session.pointer.enabled,codes:measure.codes,pointerLock:!!document.pointerLockElement}));
      assert.equal(exit.keyboard,true);assert.equal(exit.pointer,true);assert.equal(exit.pointerLock,false);assert.deepEqual(exit.codes,[[0x57,0xd7]]);
      await page.evaluate(()=>{for(const b of new TextEncoder().encode('JLX98/1 EXIT\n'))session.machine.emulator_bus.send('serial0-output-byte',b);});
      assert.deepEqual(await page.evaluate(()=>measure.codes),[[0x57,0xd7]]);
      await page.waitForTimeout(1500);
      const afterExit=await page.evaluate(()=>session.disk.readStats());
      assert(afterExit.networkBytes>clickResult.after.networkBytes,'Exit starts full download');
      await page.screenshot({path:path.join(output,`${engine}-exit.png`)});
     }
     assert.deepEqual(errors,[]);
     const result={engine,mode,base,visibleMs,readyMs,profileWaitMs:readyMs-visibleMs,profileNetworkBytes:ready.networkBytes-initial.networkBytes,elapsedMs:clickResult.elapsedMs,networkRequests,networkBytes,profile,exit,errors};
     results.push(result);await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));
     console.log(JSON.stringify({engine,mode,visibleMs,readyMs,elapsedMs:result.elapsedMs,networkRequests,networkBytes}));
    }finally{await context.close();}
   }
  }finally{await browser.close();}
 }
}finally{await server.close();}
