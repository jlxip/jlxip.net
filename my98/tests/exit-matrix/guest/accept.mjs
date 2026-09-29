import fs from 'node:fs';
import assert from 'node:assert/strict';
import {root,chromium,webkit} from './runtime.mjs';
import {serveSite} from './server.mjs';
import {quietAudio} from './audio.mjs';
const dir=root+'/',credentials=JSON.parse(fs.readFileSync(dir+'credentials.json'));
const server=await serveSite({root}),results=[];
const until=async(page,fn,timeout=30000)=>{const end=Date.now()+timeout;let last=0;while(Date.now()<end){if(await page.evaluate(fn))return;if(Date.now()-last>15000){last=Date.now();console.log('Waiting',await page.evaluate(()=>({canvas:[document.querySelector('canvas').width,document.querySelector('canvas').height],absolute:window.vm?.v86.cpu.devices.vmware.absolute,running:window.vm?.is_running()})));await page.screenshot({path:dir+'waiting-'+(process.env.ENGINE||'all')+'-'+(process.env.MOBILE||'all')+'.png'});}await page.waitForTimeout(300);}throw Error('Guest condition timeout');};
try{for(const [name,type] of Object.entries({chromium,webkit}).filter(([n])=>!process.env.ENGINE||n===process.env.ENGINE))for(const mobile of (process.env.MOBILE?[process.env.MOBILE==='1']:[false,true])){
 const browser=await type.launch({headless:true});try{
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1050,height:800},hasTouch:mobile,isMobile:mobile,acceptDownloads:true});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.addInitScript(quietAudio);await page.routeWebSocket('**/*',s=>s.close());
 // Guest links exercise the real example.com destination.
 await page.goto(server.url);await page.waitForFunction(()=>window.ready);
 await page.evaluate(async c=>disk.unlock(c.username,c.password,c.machine),credentials);
 await page.locator('#input').setInputFiles(dir+'bridge-boot.my98');await page.evaluate(async()=>{await disk.open(document.querySelector('#input').files[0]);await boot();});
 await until(page,()=>document.querySelector('canvas').width>=640,180000);
 console.log('Guest graphics ready',name,mobile,await page.evaluate(()=>({width:document.querySelector('canvas').width,absolute:vm.v86.cpu.devices.vmware.absolute})));
 await page.screenshot({path:dir+name+(mobile?'-mobile':'')+'-boot.png'});
 await page.waitForTimeout(15000);
 await page.locator('#media').setInputFiles(dir+'input.iso');await page.evaluate(()=>vm.set_cdrom({buffer:document.querySelector('#media').files[0],async:true}));
 await page.evaluate(()=>run('command.com /c copy /y d:\\matrix.htm c:\\www\\matrix.htm'));await page.waitForTimeout(3000);
 await page.evaluate(()=>run('C:\\ANS078\\BUILD\\JLXIP98.EXE --bridge'));await page.waitForTimeout(3000);
 await page.evaluate(()=>run('http://127.0.0.1/matrix.htm'));await page.waitForTimeout(10000);
 console.log('Guest IE opened',name,mobile);
 await page.screenshot({path:dir+name+(mobile?'-mobile':'')+'-loaded.png'});
 // The accepted clean-shutdown disk opens IE maximized, with fullscreen off.
 await page.evaluate(()=>vm.keyboard_send_scancodes([0x57,0xd7]));await page.waitForTimeout(2000);
 await page.evaluate(()=>{
  const surface=document.querySelector('canvas');surface.style.setProperty('width','100%','important');surface.style.setProperty('height','auto','important');
  document.querySelector('#screen').style.width='min(800px, calc(100vw - 16px))';
  attach();window.f11Count=0;const send=vm.keyboard_send_scancodes;vm.keyboard_send_scancodes=function(c,...args){if(c[0]===0x57)f11Count++;return send.call(this,c,...args);};
 });
 const canvas=page.locator('canvas'),rect=await canvas.boundingBox();
 const click=async(x,y)=>{const p={x:rect.x+x/800*rect.width,y:rect.y+y/600*rect.height};if(mobile)await page.touchscreen.tap(p.x,p.y);else await page.mouse.click(p.x,p.y);await page.waitForTimeout(900);};
 if(mobile)assert(rect.width<=390);
 assert.equal(await canvas.evaluate(e=>getComputedStyle(e).cursor),'default');assert.equal(await page.evaluate(()=>vm.keyboard_adapter.emu_enabled),false);
 // Before exit: text selection/caret, link, and busy state, with guest cursor hidden.
 await click(280,267);await page.screenshot({path:dir+name+(mobile?'-mobile':'')+'-before-text.png'});
 const popupPromise=page.waitForEvent('popup');await click(100,221);const popup=await popupPromise;await popup.waitForURL('https://example.com/');assert.equal(await popup.evaluate(()=>opener),null);await popup.close();
 await click(120,379);await page.waitForTimeout(1800);
 await page.screenshot({path:dir+name+(mobile?'-mobile':'')+'-before.png'});
 await click(130,155);await until(page,()=>window.bridge.exited);
 assert.equal(await canvas.evaluate(e=>getComputedStyle(e).cursor),'none');assert.equal(await page.evaluate(()=>vm.keyboard_adapter.emu_enabled),true);
 await click(130,245);await click(130,245);
 await click(290,357);await page.evaluate(async()=>{vm.keyboard_send_scancodes([0xe0,0x47,0xe0,0xc7,0x2a,0xe0,0x4f,0xe0,0xcf,0xaa]);await send('works');});await page.waitForTimeout(700);
 await page.screenshot({path:dir+name+(mobile?'-mobile':'')+'-after.png'});
 assert.equal(await page.evaluate(()=>f11Count),1);assert.equal(await page.evaluate(()=>serial.split('JLX98/1 EXIT\n').length-1),1);
 const verifiedPopupPromise=page.waitForEvent('popup',{timeout:10000});
 await click(120,471);const verifiedPopup=await verifiedPopupPromise;await verifiedPopup.waitForURL('https://example.com/?typed=works');await verifiedPopup.close();
 await page.screenshot({path:dir+name+(mobile?'-mobile':'')+'-verified.png'});
 // Minimize IE via the guest's own title bar and use Start afterwards.
 await click(757,8);await page.waitForTimeout(800);await click(30,587);await page.screenshot({path:dir+name+(mobile?'-mobile':'')+'-desktop.png'});
 const state=await page.evaluate(()=>({serial,exits:window.exits,f11Count,keyboard:vm.keyboard_adapter.emu_enabled,pointerLock:!!document.pointerLockElement,absolute:vm.v86.cpu.devices.vmware.absolute}));
 assert.equal(state.pointerLock,false);assert.equal(state.absolute,true);assert.deepEqual(errors,[]);
 results.push({browser:name,mobile,canvas:{width:rect.width,height:rect.height},...state,guestTypedTextVerified:true,errors});console.log(JSON.stringify(results.at(-1)));fs.writeFileSync(dir+'acceptance-'+name+(mobile?'-mobile':'-desktop')+'.json',JSON.stringify(results,null,2)+'\n');
 }catch(error){console.error(name,mobile,error);const failed=browser.contexts()[0]?.pages()[0];if(failed)await failed.screenshot({path:dir+name+(mobile?'-mobile':'')+'-failure.png'});throw error;}finally{await browser.close();}}
}finally{await server.close();}
