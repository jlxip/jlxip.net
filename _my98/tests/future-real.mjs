import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium,webkit} from '../../my98/node_modules/playwright/index.mjs';
import {serveFuture} from './future-server.mjs';
const root=path.resolve(process.env.SITE_ROOT||'.');
const output=path.resolve(process.env.EVIDENCE||'build/future-real');await mkdir(output,{recursive:true});
const server=await serveFuture(root,true),results=[];
async function resizeViewport(page,size) {
 await page.setViewportSize(size);
 // Let the actual resize listener and rendering run; do not call fit from the test.
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function checkFrame(page,presentation) {
 const viewport=page.viewportSize(),rect=await page.locator('canvas').boundingBox();
 const {width:W,height:H}=viewport,scale=rect.width/800,margin=Math.min(24,W/4,H/4);
 assert(Math.abs(rect.width/rect.height-4/3)<.01);
 assert(Math.abs(rect.y+rect.height/2-H/2)<1);
 const clipping=await page.locator('#display').evaluate(e=>getComputedStyle(e).clipPath);
 if(presentation) {
  assert.match(clipping,/^inset\(/,'presentation clips auto-hide edges');
  const hits=await page.evaluate(({rect,W,H})=>[rect.y+rect.height/600,rect.y+rect.height*599/600].filter(y=>y>=0&&y<H).map(y=>{
   const target=document.elementFromPoint(Math.min(W-1,Math.max(1,rect.x+rect.width/2)),y);
   return !!target?.closest('#display');
  }),{rect,W,H});
  assert(hits.every(hit=>!hit),'cropped strips do not send guest pointer events');
 } else assert.equal(clipping,'none','Exit restores the full input surface');
 if(presentation) {
  assert(rect.x+8*scale>=margin-1,'left content margin');
  assert(rect.x+208*scale<=W-margin+1,'all links fit horizontally');
  assert(rect.y+152*scale>=margin-1&&rect.y+448*scale<=H-margin+1,'all links fit vertically');
  if(W-2*margin>=200&&H-2*margin>=296)assert(scale>=1-.001,'natural minimum size');
  else assert(scale<1,'shrink only when content cannot fit');
  const oldScale=Math.min(W/800,H/600),oldLeft=(W-800*oldScale)/2;
  if(oldScale>=1&&oldLeft+8*oldScale>=margin) {
   assert(Math.abs(scale-oldScale)<.001&&Math.abs(rect.x-oldLeft)<1,'wide layout preserved');
  }
 } else {
  assert(Math.abs(rect.x+rect.width/2-W/2)<1);
  assert(rect.width<=W+1&&rect.height<=H+1,'whole desktop visible');
 }
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight),false);
 return {viewport,rect,scale};
}
try {
 for(const [engine,type] of Object.entries({chromium,webkit})) for(const mobile of [false,true]) {
  if(process.env.ENGINE&&process.env.ENGINE!==engine)continue;
  if(process.env.DESKTOP_ONLY&&mobile)continue;
  const browser=await type.launch();
  try {
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1100,height:850},isMobile:mobile,hasTouch:mobile});
   const page=await context.newPage(),errors=[],networkFailures=[];
   page.on('pageerror',e=>errors.push(String(e)));
   page.on('requestfailed',r=>networkFailures.push({url:r.url(),error:r.failure()?.errorText}));
   page.on('console',m=>{if(m.type()==='error')console.log(engine,m.text());});
   const begin=Date.now();await page.goto(server.url+'/future.html');
   await page.waitForFunction(()=>window.session&&!session.working,undefined,{timeout:180000});
   const loadMilliseconds=Date.now()-begin;
   const status=await page.locator('#status').textContent();assert.equal(await page.locator('#display').isVisible(),true,status);
   await page.waitForTimeout(2000);
   const details=await page.evaluate(()=>({publication:session.publication,running:session.machine.is_running(),compatibility:session.runtime.compatibility,pointer:session.pointer.enabled,keyboard:session.machine.keyboard_adapter.emu_enabled,fullscreen:!!document.fullscreenElement,pointerLock:!!document.pointerLockElement,canvas:{width:document.querySelector('canvas').width,height:document.querySelector('canvas').height},rect:(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()}));
   details.description=await page.evaluate(()=>session.disk.describe());
   assert.equal(details.running,true);assert.equal(details.pointer,true);assert.equal(details.keyboard,false);assert.equal(details.fullscreen,false);assert.equal(details.pointerLock,false);
   assert.deepEqual(errors,[]);
   const name=engine+(mobile?'-mobile':'-desktop');
   const initialViewport=page.viewportSize(),frames=[await checkFrame(page,true)];
   await page.screenshot({path:path.join(output,name+'.png')});
   await page.evaluate(()=>{window.serial='';session.machine.add_listener('serial0-output-byte',byte=>serial+=String.fromCharCode(byte));window.opened=[];window.open=()=>{const tab={opener:window,location:{replace(url){opened.push({url,openerNull:tab.opener===null});}}};return tab;};window.scancodes=[];const send=session.machine.keyboard_send_scancodes.bind(session.machine);session.machine.keyboard_send_scancodes=async codes=>{scancodes.push(codes);return send(codes);};});
   async function clickGuest(x,y){const bounds=await page.locator('canvas').boundingBox();const px=bounds.x+x/800*bounds.width,py=bounds.y+y/600*bounds.height;if(mobile)await page.touchscreen.tap(px,py);else await page.mouse.click(px,py,{delay:80});}
   if(!mobile) {
    await page.evaluate(()=>{window.buttons=[];session.machine.emulator_bus.register('mouse-click',value=>buttons.push(value));});
    const start=await page.locator('canvas').boundingBox();
    const x=start.x+24/800*start.width,y=start.y+231/600*start.height;
    await page.mouse.click(x,y,{button:'right'});
    await page.mouse.move(x,y);await page.mouse.down();
    await page.mouse.move(x+100,y+50,{steps:10});await page.mouse.up();
    await page.waitForTimeout(500);
    assert.deepEqual(await page.evaluate(()=>opened),[],'drag does not open a link');
    assert.deepEqual(await page.evaluate(()=>buttons),[],'right click and drag never press a guest button');
    const b=await page.locator('canvas').boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();
    assert.deepEqual(await page.evaluate(()=>buttons),[],'left press deferred until release');
   }
   for(const [width,height] of [[1600,900],[550,900],[390,844],[390,220],[240,200]]) {
    await resizeViewport(page,{width,height});
    if(!mobile) {assert.equal(await page.evaluate(()=>buttons.some(value=>value.some(Boolean))),false);await page.mouse.up();}
    frames.push(await checkFrame(page,true));
    await page.screenshot({path:path.join(output,`${name}-${width}x${height}-presentation.png`)});
   }
   // Actual guest COM1 action verifies pointer coordinates after cropping/resizing.
   await clickGuest(50,359);await page.waitForFunction(()=>opened.length===1,undefined,{timeout:30000});
   assert.deepEqual(await page.evaluate(()=>opened[0]),{url:'https://jlxip.net/crypto101.html',openerNull:true});
   await page.screenshot({path:path.join(output,name+'-small-link.png')});
   await resizeViewport(page,{width:390,height:220});
   await page.waitForTimeout(4500);await clickGuest(80,420);await page.waitForFunction(()=>session.bridge.exited,undefined,{timeout:15000});
   await page.waitForTimeout(1000);assert.equal(await page.evaluate(()=>session.machine.keyboard_adapter.emu_enabled),true);
   assert.equal(await page.locator('canvas').evaluate(e=>getComputedStyle(e).cursor),'none');
   await checkFrame(page,false);
   await page.evaluate(()=>{for(const byte of new TextEncoder().encode('JLX98/1 EXIT\n'))session.machine.emulator_bus.send('serial0-output-byte',byte);});
   assert.deepEqual(await page.evaluate(()=>scancodes),[[0x57,0xd7]]);
   await page.screenshot({path:path.join(output,name+'-exit.png')});
   await resizeViewport(page,initialViewport);await checkFrame(page,false);
   if(!mobile) {
    await page.evaluate(()=>buttons=[]);
    const b=await page.locator('canvas').boundingBox();
    await page.mouse.click(b.x+b.width*.7,b.y+b.height*.7,{button:'right'});
    assert(await page.evaluate(()=>buttons.some(value=>value[2])),'guest right click restored after Exit');
    await page.keyboard.press('Escape');
    await page.mouse.move(b.x+b.width*.6,b.y+b.height*.6);await page.mouse.down();
    assert.equal(await page.evaluate(()=>buttons.at(-1)[0]),true,'guest press immediate after Exit');
    await page.mouse.move(b.x+b.width*.65,b.y+b.height*.65,{steps:5});await page.mouse.up();
   }
   await page.evaluate(()=>{window.hostKeys=[];session.machine.emulator_bus.register('keyboard-code',code=>hostKeys.push(code));});
   await clickGuest(180,98);await page.keyboard.press('Control+a',{delay:100});await page.keyboard.type('about:blank',{delay:70});await page.keyboard.press('Enter',{delay:100});await page.waitForTimeout(4000);
   assert((await page.evaluate(()=>hostKeys.length))>=24);assert.deepEqual(errors,[]);
   await page.screenshot({path:path.join(output,name+'-keyboard.png')});
   assert.equal(await page.evaluate(()=>session.pointer.enabled&&!document.pointerLockElement&&!document.fullscreenElement),true);
   const audioState=await page.evaluate(()=>session.machine.speaker_adapter?.audio_context?.state||'unavailable');
   const fallback=await page.evaluate(()=>{
    const canvas=document.querySelector('canvas'),bridge=session.bridge;
    session.bridge={exited:false};canvas.width=640;canvas.height=480;session.fit();
    const r=canvas.getBoundingClientRect();session.bridge=bridge;
    return r.width<=innerWidth&&r.height<=innerHeight&&Math.abs(r.x+r.width/2-innerWidth/2)<1;
   });assert.equal(fallback,true);
   results.push({engine,mobile,frames,unknownResolutionFits:fallback,audioState,externalLink:true,exitOnce:true,keyboardAfterExit:true,loadMilliseconds,...details,networkFailures,errors});console.log(name,JSON.stringify({loadMilliseconds,frames:frames.length,canvas:details.canvas,root:details.publication.rootCid}));
   await page.evaluate(()=>session.destroy());
  }finally{await browser.close();}
 }
}finally{await server.close();await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2)+'\n');}
