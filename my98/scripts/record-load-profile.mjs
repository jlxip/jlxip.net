#!/usr/bin/env node
// Record one guest journey. External OPEN actions are captured, never navigated.
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {chromium,webkit} from '../my98/node_modules/playwright/index.mjs';
import {TorrentFixture} from '../tests/torrent-fixture.mjs';
import {DEFAULT_TORRENT_SOURCES} from '../my98/src/disk/web/torrent-sources.js';
import {serveFuture} from '../tests/future-server.mjs';

const {values}=parseArgs({options:{output:{type:'string'},site:{type:'string'},source:{type:'string'},'machine-dir':{type:'string'},'verify-only':{type:'boolean'},help:{type:'boolean'}}});
if(values.help) {
 console.log('Usage: node my98/scripts/record-load-profile.mjs [--output DIRECTORY] [--site DIRECTORY] [--source API_URL] [--machine-dir DIRECTORY] [--verify-only]\nRecords all six links, then Exit The Matrix, from the published 800x600 homepage.\nChecks every action as the first click in fresh Chromium and WebKit sessions.\nWrites load-profiles.json only after all checks pass; never publishes or opens external tabs.\n--verify-only reuses candidate.json and record.json from an interrupted run.');
 process.exit(0);
}
const output=path.resolve(values.output||'build/load-profile-all-links');
const sources=values.source?{apis:[values.source],webseeds:[values.source.replace(/\/$/,'')+'/content'],trackers:[]}:DEFAULT_TORRENT_SOURCES;
await mkdir(output,{recursive:true});
const actions=[
 {name:'my98',y:231,url:'https://my98.lol/'},
 {name:'ECDH',y:263,url:'https://jlxip.github.io/ecdh'},
 {name:'YouTube',y:295,url:'https://youtube.com/jlxip'},
 {name:"Bachelor's thesis",y:327,url:'https://jlxip.net/TFG.pdf'},
 {name:'Crypto 101',y:359,url:'https://jlxip.net/crypto101.html'},
 {name:'GitHub',y:391,url:'https://github.com/jlxip'},
 {name:'Exit The Matrix',y:423,exit:true},
];
const json=(name,value)=>writeFile(path.join(output,name),JSON.stringify(value,null,2)+'\n');
let record,profile,profileBytes,wrapperHash,recordingNow=true,server;
const fixture=new TorrentFixture(),site=path.resolve(values.site||'.');
const config=JSON.parse(await readFile('my98/runtime/config.json','utf8'));
let immutableBase;
if(values['machine-dir']) {
 const directory=path.resolve(values['machine-dir']);
 const disk=await fixture.add(path.join(directory,'disk.my98'),'disk.my98');
 const state=await fixture.add(path.join(directory,'state.my98state'),'state.my98state');
 const loadProfile=await fixture.add(path.join(directory,'load-profiles.json'),'profile.json');
 immutableBase=await fixture.add(Buffer.from(JSON.stringify({version:1,disk,state,profile:loadProfile})),'publication.json');
}

server=await serveFuture(site,true,{
 config:()=>({...config,sources:recordingNow&&!immutableBase?sources:fixture.sources(server.url)}),
 handleRequest:async(req,res,url)=>{
  const base='/build/my98-runtime/build/disk/web/';
  if(url.pathname===base+'client.js') {
   const patch=`export * from './client-original.js';import {Slop86Disk} from './client-original.js';
const originalOpen=Slop86Disk.prototype.openRemoteReadOnly,originalPrefetch=Slop86Disk.prototype.setLoadPrefetch;
Slop86Disk.prototype.openRemoteReadOnly=function(options){return originalOpen.call(this,{...options,${recordingNow&&!immutableBase?'':`infoHash:'${recordingNow?immutableBase:wrapperHash}',` }prefetchScope:'none'});};
Slop86Disk.prototype.setLoadPrefetch=async function(options){
 if(${recordingNow} && options.origin==='restored' && options.scope==='profile')await this.startLoadAnalysis({origin:'restored'});
 return originalPrefetch.call(this,{...options,scope:${recordingNow}?'none':options.scope});
};`;
   res.setHeader('Content-Type','text/javascript');res.end(patch);return true;
  }
  if(url.pathname===base+'client-original.js'){
   res.setHeader('Content-Type','text/javascript');res.end(await readFile(path.resolve(site,'build/my98-runtime/build/disk/web/client.js')));return true;
  }
  return fixture.handle(req,res,url);
 }
});
async function session(browser,recording,run) {
 const context=await browser.newContext({viewport:{width:1100,height:850}});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(String(error)));
 recordingNow=recording;
 try {
  const start=Date.now();await page.goto(server.url+'/index.html');
  await page.waitForFunction(()=>window.session&&!session.working,undefined,{timeout:180000});
  assert(await page.locator('#display').isVisible(),await page.locator('#status').textContent());
  const base=await page.evaluate(()=>session.disk.describe());
  assert.deepEqual(await page.locator('canvas').evaluate(c=>[c.width,c.height]),[800,600],'Update action coordinates for the new guest resolution');
  const visibleMs=Date.now()-start;
  if(!recording) {
   assert.equal(base.remote.infoHash,record.base.infoHash);assert.equal(base.remote.stateInfoHash,record.base.stateInfoHash);
   await page.evaluate(async()=>{const until=performance.now()+120000;while(performance.now()<until){if([...session.disk.torrentHost.sessions.values()].every(transport=>[...transport.entries.values()].every(entry=>!entry.prefetch)))return;await new Promise(r=>setTimeout(r,50));}throw Error('Profile did not complete');});
  }
  await page.evaluate(()=>{
   window.actions={opens:[],inputs:[],codes:[],exits:[]};
   document.addEventListener('pointerup',()=>actions.inputs.push(performance.now()),true);
   window.open=()=>{const tab={opener:window,location:{replace(url){actions.opens.push({url,time:performance.now(),openerNull:tab.opener===null});}}};return tab;};
   const send=session.machine.keyboard_send_scancodes.bind(session.machine);
   session.machine.keyboard_send_scancodes=c=>{actions.codes.push(c);if(c[0]===0x57)actions.exits.push(performance.now());return send(c);};
  });
  const result=await run(page,{base:base.remote,visibleMs,readyMs:Date.now()-start});
  assert.deepEqual(errors,[]);return result;
 }finally{await context.close();}
}
async function click(page,action) {
 const before=await page.evaluate(()=>session.disk.readStats());
 const count=await page.evaluate(()=>actions.opens.length);
 const rect=await page.locator('canvas').boundingBox();
 await page.mouse.click(rect.x+24/800*rect.width,rect.y+action.y/600*rect.height,{delay:80});
 if(action.exit)await page.waitForFunction(()=>session.bridge.exited,undefined,{timeout:60000});
 else await page.waitForFunction(n=>actions.opens.length>n,count,{timeout:60000});
 // The guest acknowledges OPEN after COM1; let its 100ms completion timer run.
 // Exit also restores IE chrome and paints the desktop before finishing analysis.
 await page.waitForTimeout(action.exit?5000:1000);
 const measured=await page.evaluate(async({before,count,exit})=>{
  const event=exit?{time:actions.exits[0]}:actions.opens[count];
  const after=await session.disk.readStats();
  return {elapsedMs:event.time-actions.inputs.at(-1),event,networkRequests:after.networkRequests-before.networkRequests,networkBytes:after.networkBytes-before.networkBytes,codes:actions.codes,before,after};
 },{before,count,exit:!!action.exit});
 if(action.exit)assert.deepEqual(measured.codes,[[0x57,0xd7]]);
 else {assert.equal(new URL(measured.event.url).href,new URL(action.url).href);assert.equal(measured.event.openerNull,true);}
 return {action:action.name,...measured};
}
try {
 if(values['verify-only']) {
  record=JSON.parse(await readFile(path.join(output,'record.json')));
  [profile]=JSON.parse(await readFile(path.join(output,'candidate.json')));
 } else {
  const browser=await chromium.launch();
  try {
   record=await session(browser,true,async(page,info)=>{
    const clicks=[];
    for(const action of actions) {
     const result=await click(page,action);clicks.push(result);
     console.log('Recorded:',action.name,Math.round(result.elapsedMs)+' ms');
    }
    [profile]=await page.evaluate(()=>session.disk.finishLoadAnalysis());
    assert.equal(profile.version,2);assert.equal(profile.infoHash,info.base.infoHash);assert.equal(profile.origin.kind,'state');
    await json('candidate.json',[profile]);
    await json('record-trace.json',await page.evaluate(()=>session.disk.readTrace()));
    await page.screenshot({path:path.join(output,'record-exit.png')});
    return {...info,publication:await page.evaluate(()=>session.publication),clicks,profile};
   });
   await json('record.json',record);
  }finally{await browser.close();}
 }
 assert.deepEqual(profile,record.profile,'Candidate must match the recorded journey');
 profileBytes=Buffer.from(JSON.stringify([profile]));
 if(!fixture.objects.has(record.base.infoHash))await fixture.adopt(record.base.infoHash,'disk',sources);
 if(!fixture.objects.has(record.base.stateInfoHash))await fixture.adopt(record.base.stateInfoHash,'state',sources);
 const profileHash=await fixture.add(profileBytes,'profile.json');
 wrapperHash=await fixture.add(Buffer.from(JSON.stringify({version:1,disk:record.base.infoHash,state:record.base.stateInfoHash,profile:profileHash})),'publication.json');
 const results=[];
 for(const [engine,type] of Object.entries({chromium,webkit})) {
  const browser=await type.launch();
  try {
   for(const action of actions) {
    const result=await session(browser,false,async(page,info)=>({engine,...info,...await click(page,action)}));
    results.push(result);await json('verification.json',results);
    assert.equal(result.networkBytes,0,`${engine}: ${action.name} is not fully covered`);
    console.log('Verified:',engine,action.name,Math.round(result.elapsedMs)+' ms, no network download');
   }
  }finally{await browser.close();}
 }
 // A failed/interrupted run preserves any previously verified output.
 await writeFile(path.join(output,'load-profiles.json.tmp'),profileBytes);
 await rename(path.join(output,'load-profiles.json.tmp'),path.join(output,'load-profiles.json'));
 console.log('Verified profile:',path.join(output,'load-profiles.json'));
 console.log(`${profile.coveredUnits}/${profile.observedUnits} units; ${profile.ranges.filter(Boolean).length} ranges; ${results.length} fresh sessions.`);
}finally{await server.close();}
