import fs from 'node:fs';
import {root,chromium,webkit} from './runtime.mjs';
import {serveSite} from './server.mjs';
import {quietAudio} from './audio.mjs';
import {createInterface} from 'node:readline';
const out=root+'/';
const log=fs.createWriteStream(out+'runner.log',{flags:'a'});const print=console.log;console.log=(...a)=>{log.write(a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ')+'\n');print(...a);};
const server=await serveSite({root}),browser=await (process.env.ENGINE==='webkit'?webkit:chromium).launch({headless:process.env.VISIBLE!=='1',args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const page=await browser.newPage({viewport:process.env.MOBILE==='1'?{width:390,height:844}:{width:1050,height:800},hasTouch:process.env.MOBILE==='1',isMobile:process.env.MOBILE==='1',acceptDownloads:true});
await page.addInitScript(quietAudio);await page.routeWebSocket('**/*',s=>s.close());
page.on('pageerror',e=>console.log('PAGEERROR',String(e)));
async function init(){await page.goto(server.url);await page.waitForFunction(()=>window.ready);await page.addScriptTag({path:out+'fat.js'});await page.evaluate(async c=>disk.unlock(c.username,c.password,c.machine),JSON.parse(fs.readFileSync(out+'credentials.json')));}
await init();console.log('READY '+server.url);
const lines=createInterface({input:process.stdin});
try{for await(const line of lines){try{const a=JSON.parse(line);if(a.type==='quit')break;let result;
 if(a.type==='eval')result=await page.evaluate(a.code);
 if(a.type==='run')result=await page.evaluate(s=>run(s),a.command);
 if(a.type==='keys')for(const k of a.keys)await page.keyboard.press(k,{delay:80});
 if(a.type==='shot'){await page.waitForTimeout(1000);await page.screenshot({path:out+a.name+'.png'});result=a.name;}
 if(a.type==='extract'){const bytes=await page.evaluate(p=>fat(p),a.guest);if(!bytes)throw Error('missing '+a.guest);fs.writeFileSync(out+a.name,Buffer.from(bytes));result={bytes:bytes.length,path:out+a.name};}
 if(a.type==='restore'){await page.locator('#input').setInputFiles(out+(a.name||'jlxip98-small.my98state'));result=await page.evaluate(async()=>{await restore(document.querySelector('#input').files[0]);return true;});}
 if(a.type==='disk'){await page.locator('#input').setInputFiles(out+'jlxip98-small.my98');result=await page.evaluate(async()=>disk.open(document.querySelector('#input').files[0]));}
 if(a.type==='click'){await page.mouse.click(a.x,a.y);await page.waitForTimeout(1000);result=true;}
 if(a.type==='exportRaw'){await page.evaluate(async()=>{await vm.stop();await adapter.drain();});const size=1610612736;const f=fs.openSync(out+(a.name||'dev-shutdown.img'),'wx');try{for(let off=0;off<size;off+=4194304){const count=Math.min(4194304,size-off);const b64=await page.evaluate(async({off,count})=>{const b=new Uint8Array(await disk.read(off,count));let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(s);},{off,count});const bytes=Buffer.from(b64,'base64');if(bytes.length!==count)throw Error('Short export');fs.writeSync(f,bytes,0,count,off);if(off%134217728===0)console.log(JSON.stringify({exported:off,total:size}));}}finally{fs.closeSync(f);}result={path:out+(a.name||'dev-shutdown.img'),size};}
 if(a.type==='cd'){await page.locator('#input').setInputFiles(out+'input.iso');result=await page.evaluate(async()=>{await vm.set_cdrom({buffer:document.querySelector('#input').files[0],async:true});return true;});}
 if(a.type==='open'){await init();await page.locator('#input').setInputFiles(out+(a.name||'jlxip98-small.my98')); result=await page.evaluate(async()=>{const d=await disk.open(document.querySelector('#input').files[0]);await boot();return {size:d.size};});}
 if(a.type==='state'){const download=page.waitForEvent('download',{timeout:180000});result=await page.evaluate(async()=>{const d=await capture();window.download(d.blob,'jlxip98-small.my98state');return {size:d.blob.size};});await(await download).saveAs(out+(a.name||'bridge.my98state'));}
 console.log(JSON.stringify({ok:true,result}));
}catch(e){console.log(JSON.stringify({ok:false,error:String(e)}));}}}finally{lines.close();await browser.close();await server.close();await new Promise(r=>log.end(r));process.exit(0);}
