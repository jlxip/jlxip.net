import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {chromium,webkit} from '../../my98/node_modules/playwright/index.mjs';
import {diskFixture} from '../../my98/tests/pages/fixture.mjs';
import {createIPNSRecord,marshalIPNSRecord} from '../../my98/node_modules/ipns/dist/src/index.js';
import {serveFuture} from './future-server.mjs';
const root=process.cwd();await mkdir('build/future-tests',{recursive:true});
process.chdir('my98');const fixture=await diskFixture({isolated:true});
const identity=JSON.parse(execFileSync('./build/disk-target/release/examples/compat',['identity'],{encoding:'utf8'}));process.chdir(root);
const server=await serveFuture(process.env.SITE_ROOT||root,true),results=[];
const signer={type:'Ed25519',sign:async data=>new Uint8Array(Buffer.from(execFileSync(path.join(root,'my98/build/disk-target/release/examples/compat'),['sign',Buffer.from(data).toString('hex')],{encoding:'utf8'}).trim(),'hex'))};
const noStateRecord=Buffer.from(marshalIPNSRecord(await createIPNSRecord(signer,'/ipfs/'+fixture.diskCid,1n,3600000,{v1Compatible:false})));
const expiredRecord=Buffer.from(marshalIPNSRecord(await createIPNSRecord(signer,'/ipfs/'+fixture.diskCid,999n,-60000,{v1Compatible:false})));
let saved;
try {
 for(const [engine,type] of Object.entries({chromium,webkit})) for(const mobile of [false,true]) {
  const name=engine+(mobile?'-mobile':'-desktop');console.log('Starting',name);
  const browser=await type.launch();
  try {
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1000,height:800},isMobile:mobile,hasTouch:mobile});
   let releaseCandidate;await context.exposeFunction('releaseCandidateForTest',()=>releaseCandidate?.());
   await context.addInitScript(()=>{
    // WebKit interception races immediate blob URL revocation for v86's scheduler Worker.
    // Real-publication acceptance runs without HTTP interception or this workaround.
    const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>setTimeout(()=>revoke(url),1000);
    const Original=window.Worker;window.activeWorkers=new Set();window.Worker=class extends Original{constructor(...args){super(...args);activeWorkers.add(this);}set onmessage(callback){super.onmessage=event=>{callback?.call(this,event);if(window.releaseStateOnDecompress&&event.data?.type==='progress'&&event.data.phase==='decompress')void window.releaseCandidateForTest().catch(()=>{});};}terminate(){activeWorkers.delete(this);return super.terminate();}};});await context.routeWebSocket('**/*',s=>s.close());
   // Produce an authenticated real VM state using only public fixture credentials.
   if(!saved){
   const owner=await context.newPage();
   await owner.route('**/index.html',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('window.session = module.start();','window.module = module;')});});
   await owner.goto(server.url+'/index.html');await owner.waitForFunction(()=>window.module);
   await owner.evaluate(async()=>{document.body.insertAdjacentHTML('beforeend','<input id="fixture" type="file">');});
   await owner.locator('#fixture').setInputFiles(fixture.file);
   saved=await owner.evaluate(async()=>{
    const r=await module.loadRuntime(new AbortController().signal);const disk=await r.Slop86Disk.create();
    await disk.unlock('disk fixtures','public compatibility password','main');const d=await disk.open(document.querySelector('#fixture').files[0]);
    const readKey=await disk.exportReadOnlyKey();
    const session=new module.FutureSession();session.runtime=r;
    const adapter=new r.DiskBuffer(disk,d.size);const container=document.createElement('div');container.innerHTML='<div></div><canvas></canvas>';
    const config={...r.DEFAULT_CONFIG,memory_size:16*1048576};
    const vm=await session.createMachine(adapter,config,container,new AbortController().signal);
    vm.run();await new Promise(r=>setTimeout(r,100));await vm.stop();vm.v86.cpu.mem8[0x70000]=41;await disk.write(10000,new Uint8Array([42]));
    const result=await r.captureMachineState({machine:vm,adapter,disk,config,compatibility:r.compatibility});
    for(let offset=8*1048576;offset<10*1048576;offset+=65536)crypto.getRandomValues(vm.v86.cpu.mem8.subarray(offset,offset+65536));
    const large=await r.captureMachineState({machine:vm,adapter,disk,config,compatibility:r.compatibility});
    vm.v86.cpu.mem8.fill(0,8*1048576,10*1048576);
    const bad=await disk.saveState(new ArrayBuffer(100),{version:1,config,compatibility:'wrong-build',running:true});
    const nextBase=await disk.save();
    if(await disk.exportReadOnlyKey()!==readKey)throw Error('Credential changed after saving');
    vm.v86.cpu.mem8[0x70000]=43;
    const next=await r.captureMachineState({machine:vm,adapter,disk,config,compatibility:r.compatibility});
    const data={large:Array.from(new Uint8Array(await large.blob.arrayBuffer())),bytes:Array.from(new Uint8Array(await result.blob.arrayBuffer())),bad:Array.from(new Uint8Array(await bad.blob.arrayBuffer())),next:Array.from(new Uint8Array(await next.blob.arrayBuffer())),nextDisk:Array.from(new Uint8Array(await nextBase.download.blob.arrayBuffer())),readKey};
    await vm.destroy();adapter.dispose();await disk.close();await session.destroy();return data;
   });await owner.close();console.log('Fixture state captured');
   }
   const profile={version:2,cid:fixture.diskCid,origin:{kind:'state',sha256:createHash('sha256').update(Buffer.from(saved.bytes)).digest('hex')},unitBytes:65536,ranges:[[1,1],...Array(31).fill(null)]};
   let publication=await fixture.publishState(Buffer.from(saved.bytes),undefined,[profile]),mode='good',requests=0,workerCount=0,progressive;const profileRequests=[];
   fixture.delays.set(publication.profilesCid,1500);
   await context.route('**/build/future/config.json',route=>{
    const bytes=Buffer.from(saved.readKey.slice(11),'base64url');
    if(mode==='wrong-key')bytes[32]^=1;
    if(mode==='wrong-identity')bytes[0]^=1;
    const readKey=mode==='legacy-key'?'my98-ro-v1.'+'A'.repeat(64):'my98-ro-v2.'+bytes.toString('base64url');
    return route.fulfill({json:{ipnsName:identity.ipnsName,readKey}});
   });
   // Keep production resolver/discovery, signatures and CID validation. Only HTTP
   // transport is redirected to the signed fixture, including Worker requests.
   const routeNetwork=async route=>{
    const fulfill=payload=>route.fulfill({...payload,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
    const url=new URL(route.request().url());if(url.pathname==='/ipfs/'+publication.profilesCid)profileRequests.push({method:route.request().method(),url:url.href});
    if(url.origin===server.url)return route.fallback();
    if(url.pathname.includes('/ipns/')){
     requests++;
     if(mode==='progressive-decompress') {
      const first=url.hostname==='piensa.jlxip.net';if(!first)await progressive.gate;
      return fulfill({status:200,contentType:'application/vnd.ipfs.ipns-record',body:first?progressive.old:progressive.next});
     }
     if(mode==='progressive') {
      const first=url.hostname==='piensa.jlxip.net',newer=url.hostname==='oregon.jlxip.net';
      if(!first)await new Promise(r=>setTimeout(r,newer?progressive.delay:5500));
      return fulfill({status:200,contentType:'application/vnd.ipfs.ipns-record',body:first?progressive.old:progressive.next});
     }
     if(mode==='network')return fulfill({status:503,body:'offline'});
     const response=await fetch(fixture.gateway+'/ipns/'+identity.ipnsName);
     // The first endpoint is stale. The resolver must select a newer signed record.
     let bytes=mode==='no-state'||(mode==='good'&&url.hostname==='piensa.jlxip.net')?Buffer.from(noStateRecord):mode==='expired'?Buffer.from(expiredRecord):Buffer.from(await response.arrayBuffer());
     if(mode==='bad-signature')bytes[bytes.length-1]^=1;
     return fulfill({status:200,contentType:'application/vnd.ipfs.ipns-record',body:bytes});
    }
    if(url.pathname.startsWith('/routing/v1/providers/'))return fulfill({status:200,contentType:'application/json',body:JSON.stringify({Providers:[{Schema:'peer',ID:identity.ipnsName,Protocols:['transport-ipfs-gateway-http'],Addrs:['/dns4/fixture.example.com/tcp/443/https']}]})+'\n'});
    if(url.pathname.startsWith('/ipfs/')){
     if(mode==='progressive-decompress')await new Promise(r=>setTimeout(r,100));
     const response=await fetch(fixture.gateway+url.pathname+url.search);
     return fulfill({status:response.status,contentType:response.headers.get('content-type')||'text/plain',body:Buffer.from(await response.arrayBuffer())});
    }
    return route.abort();
   };
   await context.route(/^https?:\/\//,async route=>{try{await routeNetwork(route);}catch{await route.abort().catch(()=>{});}});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')console.log(name,m.text());});
   page.on('worker',()=>workerCount++);
   async function load(expectError=false){await page.goto(server.url+'/index.html');await page.waitForFunction(()=>window.session&&!session.working,undefined,{timeout:60000});assert.equal(await page.locator('#retry').isVisible(),expectError,await page.locator('#status').textContent());if(expectError)assert.equal(await page.locator('#status').textContent(),'Something went wrong. Please try again.');}
   await load();console.log(name,'restored');
   assert.equal(await page.evaluate(()=>activeWorkers.size),2);
   assert.equal(await page.evaluate(()=>session.machine.v86.cpu.mem8[0x70000]),41);
   assert.equal(await page.evaluate(async()=>(await session.disk.read(10000,1))[0]),42);
   assert.equal(await page.evaluate(()=>session.machine.is_running()),true); // saved paused
   assert.equal(await page.evaluate(()=>session.publication.rootCid),publication.publicationCid);
   assert.equal(await page.evaluate(()=>session.machine.keyboard_adapter.emu_enabled),false);
   assert.equal(await page.evaluate(()=>session.pointer.enabled),true);
   const loadingProfile=await page.evaluate(()=>session.disk.readStats());
   assert.equal(loadingProfile.remote.loadProfile.scope,'profile');assert.equal(loadingProfile.remote.loadProfile.status,'loading');
   // Exit during metadata loading upgrades the same request, without delaying the restored canvas.
   await page.evaluate(()=>{for(const b of new TextEncoder().encode('JLX98/1 EXIT\n'))session.machine.emulator_bus.send('serial0-output-byte',b);});
   await page.evaluate(async()=>{for(let i=0;i<500;i++){const r=(await session.disk.readStats()).remote;if(r.loadProfile.scope==='disk' && r.prefetchState==='complete')return;await new Promise(r=>setTimeout(r,10));}throw Error('Early Exit did not finish prefetch');});
   assert.equal(profileRequests.filter(r=>r.method==='GET').length,1,'early Exit reuses the metadata request');

   await page.evaluate(async()=>{await session.disk.write(10000,new Uint8Array([99]));for(const op of ['save','downloadCurrent','exportReadOnlyKey']){try{await session.disk[op]();throw Error('Owner operation allowed');}catch(e){if(e.code!=='READ_ONLY')throw e;}}});
   const initialRequests=requests;
   const nextPublication=await fixture.publishState(Buffer.from(saved.next),Buffer.from(saved.nextDisk));
   assert.notEqual(nextPublication.diskCid,publication.diskCid);
   assert.notEqual(nextPublication.publicationCid,publication.publicationCid);
   assert.equal(await page.evaluate(()=>session.publication.rootCid),publication.publicationCid);
   assert.equal(requests,initialRequests);
   await load();assert.equal(await page.evaluate(async()=>(await session.disk.read(10000,1))[0]),42);
   assert.equal(await page.evaluate(()=>session.machine.v86.cpu.mem8[0x70000]),43);
   // Fail a read through the actual adapter, then retry without replacing the VM.
   const retry=await page.evaluate(async()=>{
    const machine=session.machine,disk=session.disk,read=disk.read.bind(disk);let once=true;
    disk.read=(...args)=>{if(once){once=false;throw Object.assign(Error('fixture offline'),{code:'IO_ERROR'});}return read(...args);};
    session.adapter.get(12345,1,()=>{});
    for(let i=0;i<500&&(session.adapter.pumping||machine.is_running());i++)await new Promise(r=>setTimeout(r,20));
    const paused=!machine.is_running()&&session.adapter.failed;
    await session.retryDisk();return {paused,same:machine===session.machine,running:machine.is_running()};
   });assert.deepEqual(retry,{paused:true,same:true,running:true});
   // Real serial output event drives the shared bridge, including repeat EXIT.
   await page.evaluate(()=>{for(const byte of new TextEncoder().encode('JLX98/1 EXIT\nJLX98/1 EXIT\n'))session.machine.emulator_bus.send('serial0-output-byte',byte);});
   await page.waitForFunction(()=>session.bridge.exited);
   assert.equal(await page.evaluate(()=>session.machine.keyboard_adapter.emu_enabled),true);
   assert.equal(await page.locator('canvas').evaluate(e=>getComputedStyle(e).cursor),'none');
   assert.equal(await page.evaluate(()=>!!document.pointerLockElement),false);
   await page.screenshot({path:`build/future-tests/${name}-restored.png`});
   for(const failure of ['network','bad-signature','expired','no-state','wrong-key','wrong-identity','legacy-key']){mode=failure;await load(true);assert.equal(await page.locator('#display').isVisible(),false);assert.equal(await page.evaluate(()=>!!session.machine||!!session.disk),false);assert.equal(await page.evaluate(()=>activeWorkers.size),0);}
   mode='good';await fixture.publishState(Buffer.from(saved.bad));await load(true);
   await fixture.publishState(Buffer.from(saved.bytes));
   const beforeRetry=requests;await page.evaluate(()=>Promise.all([session.load(),session.load()]));
   assert.equal(requests-beforeRetry,6);assert.equal(await page.evaluate(()=>activeWorkers.size),2);
   assert.equal(await page.locator('#display').isVisible(),true);
   // A restored and already used provisional VM must be replaced by the newer
   // signed publication, without waiting for endpoints beyond the global deadline.
   if(!mobile) {
    const first=await fixture.publishState(Buffer.from(saved.bytes));
    const old=Buffer.from(await (await fetch(fixture.gateway+'/ipns/'+identity.ipnsName)).arrayBuffer());
    const newer=await fixture.publishState(Buffer.from(saved.next),Buffer.from(saved.nextDisk));
    const next=Buffer.from(await (await fetch(fixture.gateway+'/ipns/'+identity.ipnsName)).arrayBuffer());
    progressive={old,next,delay:3000};mode='progressive';
    await page.goto(server.url+'/index.html');
    await page.waitForFunction(()=>window.session?.machine && !session.display.hidden && session.machine.v86.cpu.mem8[0x70000]===41,undefined,{timeout:2500});
    await page.locator('canvas').click({position:{x:30,y:30}});
    await page.evaluate(()=>{window.provisional=session.machine;session.machine.v86.cpu.mem8[0x70000]=77;});
    await page.waitForFunction(()=>!session.working,undefined,{timeout:10000});
    assert.equal(await page.evaluate(()=>session.machine.v86.cpu.mem8[0x70000]),43);
    assert.equal(await page.evaluate(()=>session.machine!==provisional),true);
    assert.equal(await page.evaluate(()=>session.publication.rootCid),newer.publicationCid);
    assert.equal(await page.evaluate(()=>session.timings.attempts.length),2);
    assert.equal(await page.evaluate(()=>activeWorkers.size),2);
    assert(await page.evaluate(()=>session.timings.resolutionFinal-session.timings.resolutionStart<5300));
    await page.waitForTimeout(700);assert.equal(await page.evaluate(()=>session.timings.attempts.length),2);
    // Reuse the prepared runtime on Retry. Switch while the first preparation is
    // blocked on a state block; the cancelled attempt must never become visible.
    // Earlier loads now persist this state. Empty the optional cache so the
    // delayed block actually blocks restoration while keeping the prepared runtime.
    await page.evaluate(async()=>{
     await session.disposeSession();
     await new Promise((resolve,reject)=>{
      const request=indexedDB.deleteDatabase('my98-published-cache-v1');
      request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);
     });
    });
    progressive.delay=100;fixture.delays.set(first.stateCid,1800);
    await page.evaluate(()=>session.load());
    fixture.delays.delete(first.stateCid);
    assert.equal(await page.evaluate(()=>session.machine.v86.cpu.mem8[0x70000]),43);
    assert.equal(await page.evaluate(()=>activeWorkers.size),2);
    assert.equal(await page.evaluate(()=>session.timings.attempts[0].visible),undefined);
    // Release the newer signed reference only on a real decompression progress
    // event. A larger authenticated state plus delayed blocks keeps its old
    // pipeline active, rather than merely cancelling before state preparation.
    await fixture.publishState(Buffer.from(saved.large));
    const largeRecord=Buffer.from(await (await fetch(fixture.gateway+'/ipns/'+identity.ipnsName)).arrayBuffer());
    const final=await fixture.publishState(Buffer.from(saved.next),Buffer.from(saved.nextDisk));
    const finalRecord=Buffer.from(await (await fetch(fixture.gateway+'/ipns/'+identity.ipnsName)).arrayBuffer());
    progressive={old:largeRecord,next:finalRecord,gate:new Promise(r=>releaseCandidate=r)};mode='progressive-decompress';
    await context.addInitScript(()=>window.releaseStateOnDecompress=true);
    await page.goto(server.url+'/index.html');
    await page.waitForFunction(()=>window.session&&!session.working,undefined,{timeout:30000});
    assert.equal(await page.evaluate(()=>session.timings.attempts.length),2);
    assert(await page.evaluate(()=>session.timings.attempts[0].phases.decompress.first>0));
    assert.equal(await page.evaluate(()=>session.timings.attempts[0].visible),undefined);
    assert.equal(await page.evaluate(()=>session.publication.rootCid),final.publicationCid);
    assert.equal(await page.evaluate(()=>session.machine.v86.cpu.mem8[0x70000]),43);
    assert.equal(await page.evaluate(()=>activeWorkers.size),2);releaseCandidate=undefined;
    progressive={old,next,delay:3000};mode='progressive';
    // Leave during resolution and restoration; no callback may revive the page.
    progressive.delay=3000;fixture.delays.set(first.stateCid,1800);
    await page.evaluate(()=>{void session.load();});
    await page.waitForFunction(()=>session.timings.attempts.length>0);
    await page.evaluate(()=>session.destroy());fixture.delays.delete(first.stateCid);
    await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>activeWorkers.size),0);
   }
   await page.evaluate(()=>session.destroy());assert.equal(await page.evaluate(()=>activeWorkers.size),0);assert.equal(await page.evaluate(()=>!!session.machine||!!session.disk),false);
   assert.deepEqual(errors,[]);results.push({browser:engine,mobile,latestValid:true,expiredRejected:true,noStateRejected:true,cleanup:true,ramAndOverlay:true,readOnly:true,sessionReset:true,retryPreservesVM:true,profileDoesNotBlockDisplay:true,earlyExitReusesProfile:true,errors:errors.length,workers:workerCount});console.log(results.at(-1));
  }finally{await browser.close();}
 }
}finally{await fixture.close();await server.close();}
await writeFile('build/future-tests/results.json',JSON.stringify(results,null,2));
