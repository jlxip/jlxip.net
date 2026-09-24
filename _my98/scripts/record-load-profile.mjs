#!/usr/bin/env node
// Record one guest journey. External OPEN actions are captured, never navigated.
import assert from 'node:assert/strict';
import {parseArgs} from 'node:util';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {chromium,webkit} from '../../my98/node_modules/playwright/index.mjs';
import {CID} from '../../my98/node_modules/multiformats/dist/src/cid.js';
import {sha256} from '../../my98/node_modules/multiformats/dist/src/hashes/sha2.js';
import * as dagPB from '../../my98/node_modules/@ipld/dag-pb/src/index.js';
import {UnixFS} from '../../my98/node_modules/ipfs-unixfs/dist/src/index.js';
import {serveFuture} from '../tests/future-server.mjs';

const {values}=parseArgs({options:{output:{type:'string'},site:{type:'string'},gateway:{type:'string'},'verify-only':{type:'boolean'},help:{type:'boolean'}}});
if(values.help) {
 console.log('Usage: node _my98/scripts/record-load-profile.mjs [--output DIRECTORY] [--site DIRECTORY] [--gateway URL] [--verify-only]\nRecords all six links, then Exit The Matrix, from the published 800x600 homepage.\nChecks every action as the first click in fresh Chromium and WebKit sessions.\nWrites load-profiles.json only after all checks pass; never publishes or opens external tabs.\n--verify-only reuses candidate.json and record.json from an interrupted run.');
 process.exit(0);
}
const output=path.resolve(values.output||'build/load-profile-all-links');
const gateway=(values.gateway||'https://piensa.jlxip.net').replace(/\/$/,'');
assert(['http:','https:'].includes(new URL(gateway).protocol),'Gateway must use HTTP(S)');
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
const server=await serveFuture(path.resolve(values.site||'.'),true);
let record,profile,wrapper,wrapperCid,profileBytes,profileCid;
async function session(browser,recording,run) {
 const context=await browser.newContext({viewport:{width:1100,height:850}});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(String(error)));
 // Let intercepted module workers finish loading in WebKit before revocation.
 await context.addInitScript(()=>{const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>setTimeout(()=>revoke(url),1000);});
 try {
  await context.route('**/build/disk/web/client.js',async route=>{
   const response=await route.fetch();
   const patch=`\nconst originalOpen=Slop86Disk.prototype.openReadOnly, originalPrefetch=Slop86Disk.prototype.setLoadPrefetch;
Slop86Disk.prototype.openReadOnly=function(options){return originalOpen.call(this,{...options,cid:${JSON.stringify(recording?null:wrapperCid)}||options.cid,gateway:${JSON.stringify(gateway)},prefetch:{enabled:false,trace:true}});};
Slop86Disk.prototype.setLoadPrefetch=async function(options){
 if(${recording} && options.origin==='restored' && options.scope==='profile')await this.startLoadAnalysis({origin:'restored'});
 // Recording excludes speculation. Verification holds full-disk prefetch on Exit
 // so its deliberate traffic cannot be mistaken for a missed demand read.
 return originalPrefetch.call(this,{...options,scope:${recording}?'none':options.scope==='disk'?'profile':options.scope});
};`;
   await route.fulfill({response,body:await response.text()+patch});
  });
  if(!recording)await context.route(gateway+'/ipfs/**',async route=>{
   const cid=new URL(route.request().url()).pathname.split('/ipfs/')[1];
   if(cid!==wrapperCid && cid!==profileCid)return route.continue();
   await route.fulfill({status:200,contentType:'application/vnd.ipld.raw',headers:{'Access-Control-Allow-Origin':'*'},body:cid===wrapperCid?wrapper:profileBytes});
  });
  const start=Date.now();await page.goto(server.url+'/index.html');
  await page.waitForFunction(()=>window.session&&!session.working,undefined,{timeout:180000});
  assert(await page.locator('#display').isVisible(),await page.locator('#status').textContent());
  const base=await page.evaluate(()=>session.disk.describe());
  assert.deepEqual(await page.locator('canvas').evaluate(c=>[c.width,c.height]),[800,600],'Update action coordinates for the new guest resolution');
  const visibleMs=Date.now()-start;
  if(!recording) {
   assert.equal(base.remote.cid,record.base.cid);assert.equal(base.remote.stateCid,record.base.stateCid);
   await page.evaluate(async()=>{const until=performance.now()+120000;while(performance.now()<until){const r=(await session.disk.readStats()).remote;if(r.loadProfile?.status==='complete'&&r.prefetchState==='complete')return;await new Promise(r=>setTimeout(r,50));}throw Error('Profile did not complete');});
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
    assert.equal(profile.version,2);assert.equal(profile.cid,info.base.cid);assert.equal(profile.origin.kind,'state');
    await json('candidate.json',[profile]);
    await json('record-trace.json',await page.evaluate(()=>session.disk.readTrace()));
    await page.screenshot({path:path.join(output,'record-exit.png')});
    return {...info,publication:await page.evaluate(()=>session.publication),clicks,profile};
   });
   await json('record.json',record);
  }finally{await browser.close();}
 }
 assert.deepEqual(profile,record.profile,'Candidate must match the recorded journey');
 profileBytes=Buffer.from(JSON.stringify([profile]));profileCid=CID.createV1(0x55,await sha256.digest(profileBytes)).toString();
 wrapper=Buffer.from(dagPB.encode(dagPB.prepare({Data:new UnixFS({type:'directory'}).marshal(),Links:[
  {Name:'disk.my98',Hash:CID.parse(record.base.cid),Tsize:0},
  {Name:'state.my98state',Hash:CID.parse(record.base.stateCid),Tsize:0},
  {Name:'load-profiles.json',Hash:CID.parse(profileCid),Tsize:profileBytes.length},
 ]})));wrapperCid=CID.createV1(0x70,await sha256.digest(wrapper)).toString();
 await writeFile(path.join(output,'publication.pb'),wrapper);
 const results=[];
 for(const [engine,type] of Object.entries({chromium,webkit})) {
  const browser=await type.launch();
  try {
   for(const action of actions) {
    const result=await session(browser,false,async(page,info)=>({engine,...info,...await click(page,action)}));
    results.push(result);await json('verification.json',results);
    assert.equal(result.networkRequests,0,`${engine}: ${action.name} is not fully covered`);
    console.log('Verified:',engine,action.name,Math.round(result.elapsedMs)+' ms, no disk requests');
   }
  }finally{await browser.close();}
 }
 // A failed/interrupted run preserves any previously verified output.
 await writeFile(path.join(output,'load-profiles.json.tmp'),profileBytes);
 await rename(path.join(output,'load-profiles.json.tmp'),path.join(output,'load-profiles.json'));
 console.log('Verified profile:',path.join(output,'load-profiles.json'));
 console.log(`${profile.coveredUnits}/${profile.observedUnits} units; ${profile.ranges.filter(Boolean).length} ranges; ${results.length} fresh sessions.`);
}finally{await server.close();}
