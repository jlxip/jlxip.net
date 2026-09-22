import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(path.resolve('my98/package.json'));
const {chromium,webkit}=require('playwright');
const root=process.cwd(),out=path.join(root,'build/exit-matrix');await fs.mkdir(out,{recursive:true});
const server=http.createServer(async(req,res)=>{
 if(req.url==='/__direct-pointer.js'){res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(path.resolve(process.env.MY98_SOURCE || '../my98','src/browser/direct-pointer.js')));return;}
 if(req.url==='/target'){res.end('<title>External target</title>Destination');return;}
 try{const p=path.resolve(root,'.'+new URL(req.url,'http://x').pathname);assert(p.startsWith(root+'/'));res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':'text/html');res.end(await fs.readFile(p));}catch{res.writeHead(404).end();}
});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const results=[];
try{for(const [name,type] of Object.entries({chromium,webkit}))for(const mobile of [false,true]){
 const browser=await type.launch({headless:true});try{
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1000,height:800},hasTouch:mobile,isMobile:mobile});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(origin+'/_my98/tests/exit-matrix/host.html');await page.waitForFunction(()=>window.test);
 const surface=page.locator('canvas');assert.equal(await surface.evaluate(e=>getComputedStyle(e).cursor),'default');
 if(mobile)await page.touchscreen.tap(195,146);else await page.mouse.click(400,300);
 let events=await page.evaluate(()=>test.events);assert(events.some(e=>e[0]==='mouse-absolute'));
 assert.equal(await page.evaluate(()=>!!document.pointerLockElement),false);
 await page.evaluate(()=>test.feed('JLX98/1 EX'));assert.equal(await page.evaluate(()=>test.bridge.exited),false);
 await page.evaluate(()=>test.feed('IT\nJLX98/1 EXIT\n'));assert.equal(await surface.evaluate(e=>getComputedStyle(e).cursor),'none');
 assert.equal(await page.evaluate(()=>test.events.filter(e=>e[0]==='keys').length),1);
 if(mobile)await page.touchscreen.tap(10,10);else await page.mouse.click(10,10);
 events=await page.evaluate(()=>test.events);assert(events.filter(e=>e[0]==='mouse-absolute').length>=2);
 const popupPromise=page.waitForEvent('popup');await page.locator('#open').click();const popup=await popupPromise;await popup.waitForURL(origin+'/target');assert.equal(await popup.evaluate(()=>opener),null);await popup.close();
 await page.screenshot({path:path.join(out,name+(mobile?'-mobile':'-desktop')+'.png')});
 // Deterministic denied popup branch, inside both real browser engines.
 await page.evaluate(()=>{window.open=()=>null;test.feed('JLX98/1 OPEN '+encodeURIComponent(location.origin+'/target')+'\n');});await page.waitForURL(origin+'/target');
 assert.deepEqual(errors,[]);results.push({browser:name,mobile,absoluteInput:true,pointerLock:false,oneF11:true,cursorTransition:true,popupAllowed:true,openerNull:true,deniedFallback:true,errors});
 }finally{await browser.close();}}
}finally{await new Promise(r=>server.close(r));}
await fs.writeFile(path.join(out,'browser.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
