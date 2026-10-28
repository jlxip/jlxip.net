import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {chromium,webkit} from '../my98/node_modules/playwright/index.mjs';
import {diskFixture} from '../my98/tests/pages/fixture.mjs';
import {serveFuture} from './future-server.mjs';
import {TorrentFixture} from './torrent-fixture.mjs';
import {checkDownloadProgress} from './download-progress.mjs';
import {checkStartupPrefetch} from './startup-prefetch.mjs';
const root=process.cwd(),output=path.resolve('build/future-tests');await mkdir(output,{recursive:true});
process.chdir('my98/my98');const diskFile=await diskFixture({sizeBytes:16*1024*1024});process.chdir(root);
const torrent=new TorrentFixture(),diskHash=await torrent.add(diskFile.file,'disk.my98');
let readKey,server,profileHash;
const entry=await readFile('my98/index.html','utf8');
server=await serveFuture(process.env.SITE_ROOT||root,true,{
 config:()=>({readKey,sources:torrent.sources(server.url)}),
 handleRequest:async(req,res,url)=>{
  if(url.pathname==='/owner.html'){
   res.setHeader('Content-Type','text/html');res.end(entry.replace('module => module.start()','module => {window.module=module;}'));return true;
  }
  return torrent.handle(req,res,url);
 }
});
const results=[];
try {
 const browser=await chromium.launch();
 try {
  const owner=await browser.newPage();await owner.goto(server.url+'/owner.html');await owner.waitForFunction(()=>window.module);
  await owner.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<input id="fixture" type="file">'));
  await owner.locator('#fixture').setInputFiles(diskFile.file);
  const saved=await owner.evaluate(async()=>{
   const r=await module.loadRuntime(new AbortController().signal),disk=await r.Slop86Disk.create();
   await disk.unlock('disk fixtures','public compatibility password','main');const description=await disk.open(document.querySelector('#fixture').files[0]);
   const readKey=await disk.exportReadOnlyKey(),session=new module.FutureSession();session.runtime=r;
   const adapter=new r.DiskBuffer(disk,description.size),container=document.createElement('div');container.innerHTML='<div></div><canvas></canvas>';
   const config={...r.DEFAULT_CONFIG,memory_size:16*1048576};
   const vm=await session.createMachine(adapter,config,container,new AbortController().signal);
   vm.run();
   // Wait for the fixture's CLI/HLT boot sector; BIOS can still clear RAM earlier.
   const deadline=performance.now()+10000;
   while(!(vm.v86.cpu.in_hlt[0] && vm.v86.cpu.instruction_pointer[0]===0x7c02)) {
    if(performance.now()>deadline)throw Error('Fixture boot sector did not halt');
    await new Promise(resolve=>setTimeout(resolve,10));
   }
   await vm.stop();
   vm.v86.cpu.mem8[0x70000]=41;await disk.write(10000,new Uint8Array([42]));
   // Several incompressible pieces let the real transport expose intermediate progress.
   let random=0x12345678;
   for(let i=0x100000;i<0x300000;i++) {
    random^=random<<13;random^=random>>>17;random^=random<<5;
    vm.v86.cpu.mem8[i]=random&255;
   }
   const saved=await r.captureMachineState({machine:vm,adapter,disk,config,compatibility:r.compatibility});
   const bad=await disk.saveState(new ArrayBuffer(100),{version:1,config,compatibility:'wrong-build',running:true});
   const result={bytes:Array.from(new Uint8Array(await saved.blob.arrayBuffer())),bad:Array.from(new Uint8Array(await bad.blob.arrayBuffer())),readKey};
   await vm.destroy();adapter.dispose();await disk.close();await session.destroy();return result;
  });
  readKey=saved.readKey;
  const stateBytes=Buffer.from(saved.bytes),state=await torrent.add(stateBytes,'state.my98state');
  const profile=[{version:2,infoHash:diskHash,unitBytes:65536,origin:{kind:'state',sha256:createHash('sha256').update(stateBytes).digest('hex')},ranges:[[20,20],[21,21],[24,24],[255,255],...Array(28).fill(null)]}];
  profileHash=await torrent.add(Buffer.from(JSON.stringify(profile)),'profile.json');
  const descriptor=await torrent.publish(diskHash,state,profileHash);
  await owner.close();
  results.push({fixture:{disk:diskHash,state,profile:profileHash,descriptor}});
  await checkDownloadProgress({server,torrent,state,stateBytes,diskHash,profile:profile[0],output,results});
  await checkStartupPrefetch({server,torrent,state,diskHash,profileHash,profile:profile[0],results});
  // Reuse the immutable authenticated fixture in both engines and viewport modes.
  for(const [engine,type] of Object.entries({chromium,webkit}))for(const mobile of [false,true]){
   console.log('Fixture',engine,mobile);const b=await type.launch();
   try {
    const context=await b.newContext({viewport:mobile?{width:390,height:844}:{width:1100,height:850},isMobile:mobile,hasTouch:mobile});
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(server.url+'/');await page.waitForFunction(()=>window.session&&!session.working,undefined,{timeout:60000});
    assert.equal(await page.locator('#display').isVisible(),true,await page.locator('#status').textContent());
    assert.equal(await page.evaluate(()=>session.machine.v86.cpu.mem8[0x70000]),41);
    assert.equal(await page.evaluate(async()=>(await session.disk.read(10000,1))[0]),42);
    assert.equal(await page.evaluate(()=>session.publication.infoHash),descriptor);
    assert.equal(await page.evaluate(()=>session.machine.keyboard_adapter.emu_enabled),false);
    assert.equal(await page.evaluate(()=>session.attempt.metrics.prefetch.outcome),'complete');
    assert(await page.evaluate(()=>session.attempt.metrics.prefetchFinished<=session.attempt.metrics.visible));
    await page.waitForFunction(()=>[...session.disk.torrentHost.sessions.values()].every(transport=>[...transport.entries.values()].every(entry=>!entry.prefetch)),undefined,{timeout:60000});
    await page.waitForTimeout(500);
    const first=await page.evaluate(()=>session.disk.readStats());
    assert.equal(first.remote.scope,'profile');assert.equal(first.remote.complete,false);
    await page.evaluate(()=>{for(const byte of new TextEncoder().encode('JLX98/1 EXIT\n'))session.machine.emulator_bus.send('serial0-output-byte',byte);});
    assert.equal(await page.evaluate(()=>session.bridge.exited),true);
    assert.equal(await page.evaluate(()=>session.machine.keyboard_adapter.emu_enabled),true);
    await page.waitForTimeout(500);const idle=await page.evaluate(()=>session.disk.readStats());
    assert.equal(idle.networkBytes,first.networkBytes,'Exit must not start a full disk download');
    assert.equal(idle.remote.scope,'profile');
    await page.evaluate(async()=>{await session.disk.read(128*65536,512);});
    const demand=await page.evaluate(()=>session.disk.readStats());assert(demand.networkBytes>idle.networkBytes);
    const retry=await page.evaluate(async()=>{
     const machine=session.machine,disk=session.disk,read=disk.read.bind(disk);let once=true;
     disk.read=(...args)=>{if(once){once=false;throw Object.assign(Error('fixture offline'),{code:'IO_ERROR'});}return read(...args);};
     session.adapter.get(12345,1,()=>{});
     for(let i=0;i<500&&(session.adapter.pumping||machine.is_running());i++)await new Promise(resolve=>setTimeout(resolve,10));
     const paused=!machine.is_running()&&session.adapter.failed;await session.retryDisk();
     return {paused,same:machine===session.machine,running:machine.is_running()};
    });assert.deepEqual(retry,{paused:true,same:true,running:true});
    const prohibited=await page.evaluate(async()=>{
     const codes=[];for(const operation of ['save','downloadCurrent','exportReadOnlyKey'])try{await session.disk[operation]();codes.push('allowed');}catch(error){codes.push(error.code);}return codes;
    });assert.equal(prohibited.length,3);assert(prohibited.every(code=>['READ_ONLY','OPERATION_FAILED'].includes(code)));
    await page.screenshot({path:path.join(output,engine+(mobile?'-mobile':'-desktop')+'-exit.png')});
    assert.deepEqual(errors,[]);results.push({engine,mobile,restore:true,profileOnly:true,demand:true,retry,readOnly:true});
   }finally{await b.close();}
  }
  for(const [engine,type] of Object.entries({chromium,webkit}))for(const mode of ['no-state','bad-runtime','bad-signature','wrong-key','offline','no-profile','bad-profile','wrong-profile-state']){
   console.log('Negative fixture',engine,mode);torrent.mode='online';
   const badState=mode==='bad-runtime'?await torrent.add(Buffer.from(saved.bad),'state.my98state'):state;
   const selectedProfile=mode==='no-profile'?null:mode==='bad-profile'?await torrent.add(Buffer.from('{}'),'profile.json'):mode==='wrong-profile-state'?await torrent.add(Buffer.from(JSON.stringify([{...profile[0],origin:{kind:'state',sha256:'00'.repeat(32)}}])),'profile.json'):profileHash;
   await torrent.publish(diskHash,mode==='no-state'?null:badState,selectedProfile);
   if(['bad-signature','offline'].includes(mode))torrent.mode=mode;
   const original=readKey;if(mode==='wrong-key'){const bytes=Buffer.from(readKey.slice(11),'base64url');bytes[32]^=1;readKey='my98-ro-v2.'+bytes.toString('base64url');}
   const b=await type.launch();try{
    const page=await b.newPage();await page.goto(server.url+'/');
    await page.waitForFunction(()=>window.session&&!session.working,undefined,{timeout:60000});
    const optional=['no-profile','bad-profile','wrong-profile-state'].includes(mode);
    assert.equal(await page.locator('#retry').isVisible(),!optional,mode);
    assert.equal(await page.locator('#display').isVisible(),optional,mode);
    if(optional) {
     assert.equal(await page.evaluate(()=>session.attempt.metrics.prefetch.outcome),'fallback');
     assert.equal(await page.evaluate(async()=>(await session.disk.read(10000,1))[0]),42);
    }
    if(mode==='offline') {
     torrent.mode='online';await page.locator('#retry').click();
     await page.waitForFunction(()=>window.session&&!session.working,undefined,{timeout:60000});
     assert.equal(await page.locator('#display').isVisible(),true,'Retry must restore after source recovery');
    }
    results.push({engine,mode,passed:true});
   }finally{readKey=original;await b.close();}
  }
 }finally{await browser.close();}
 await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2)+'\n');console.log('WebTorrent signed fixtures: PASS',results.length-1,'cases');
}finally{await server.close();await diskFile.close();}
