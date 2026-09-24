import assert from 'node:assert/strict';
import {chromium,webkit} from '../../my98/node_modules/playwright/index.mjs';
import {serveFuture} from './future-server.mjs';
const server=await serveFuture();
try {
 for(const [engine,type] of Object.entries({chromium,webkit})) {
  const browser=await type.launch();
  try {
   const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
   await page.goto(server.url+'/__input-test__');
   await page.setContent('<div id="display" style="position:absolute;left:0;top:0;width:400px;height:300px;touch-action:none"><canvas width="400" height="300"></canvas></div>');
   await page.evaluate(async()=>{
    const {guardPresentationInput}=await import('/_my98/runtime/presentation-input.js');
    const {setupDirectPointer}=await import('/my98/src/browser/direct-pointer.js');
    window.events=[];window.exited=false;
    const display=document.querySelector('#display');
    window.guard=guardPresentationInput({display,unlocked:()=>exited});
    const vm={bus:{send:(type,value)=>events.push({type,value})},is_running:()=>true,mouse_set_enabled:()=>{}};
    window.pointer=setupDirectPointer({display,getSurface:()=>display.querySelector('canvas'),getMachine:()=>vm});pointer.activate();events=[];
   });
   const clear=()=>page.evaluate(()=>events=[]);
   const buttons=()=>page.evaluate(()=>events.filter(e=>e.type==='mouse-click').map(e=>e.value));
   await page.mouse.click(40,40,{button:'right'});assert.deepEqual(await buttons(),[]);
   await page.mouse.click(40,40,{button:'middle'});assert.deepEqual(await buttons(),[]);
   await page.mouse.move(40,40);await page.mouse.down();assert.deepEqual(await buttons(),[]);
   await page.mouse.up();assert.deepEqual(await buttons(),[[true,false,false],[false,false,false]]);
   await clear();await page.mouse.down();await page.mouse.move(120,80,{steps:8});await page.mouse.move(40,40);await page.mouse.up();assert.deepEqual(await buttons(),[],'returning a drag to its origin still cancels');
   await clear();await page.mouse.down();await page.mouse.move(500,400);await page.mouse.up();assert.deepEqual(await buttons(),[],'outside release cancels');
   await page.mouse.move(40,40);await page.mouse.down();await page.evaluate(()=>guard.reset());await page.mouse.up();assert.deepEqual(await buttons(),[],'resize/session reset cancels');
   await page.mouse.down();await page.mouse.down({button:'right'});await page.mouse.up({button:'right'});await page.mouse.up();assert.deepEqual(await buttons(),[],'button chord cancels');
   await page.mouse.down();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();assert.deepEqual(await buttons(),[],'blur cancels');
   await page.evaluate(()=>exited=true);await page.mouse.down();assert.deepEqual(await buttons(),[[true,false,false]],'unlocked press is immediate');await page.mouse.move(90,90);await page.mouse.up();
   await clear();await page.mouse.click(90,90,{button:'right'});assert.deepEqual(await buttons(),[[false,false,true],[false,false,false]]);
   await page.evaluate(()=>{guard.destroy();pointer.destroy();});assert.deepEqual(errors,[]);console.log(engine,'presentation input PASS');
  }finally{await browser.close();}
 }
}finally{await server.close();}
