import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium,webkit} from '../my98/node_modules/playwright/index.mjs';

const root=path.resolve(process.env.SITE_ROOT||'build/site');
const output=path.resolve(process.env.EVIDENCE||'build/runtime-cache');
await mkdir(output,{recursive:true});
const entry=await readFile(path.join(root,'index.html'),'utf8');
const appPath=entry.match(/import\(['"]([^'"]*build\/future\/app\.js[^'"]*)['"]\)/)?.[1];
assert(appPath?.includes('?v='),'The built entry must version the app URL');
const stale=['/build/future/app.js','/build/my98-runtime/build/disk/web/client.js','/build/my98-runtime/build/disk/web/worker.js'];
let requests=[];
const server=http.createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://localhost');requests.push(url.pathname+url.search);
  if(url.pathname==='/cache-setup.html') {
   res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'}).end('<!doctype html><title>cache setup</title>');return;
  }
  if(stale.includes(url.pathname)&&!url.search) {
   res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'max-age=600'}).end('throw Error("Unversioned stale asset selected");');return;
  }
  const file=path.resolve(root,'.'+url.pathname);assert(file.startsWith(root+path.sep));
  const bytes=await readFile(file);
  res.writeHead(200,{'Content-Type':/\.m?js$/.test(file)?'text/javascript':file.endsWith('.wasm')?'application/wasm':'application/octet-stream','Cache-Control':'max-age=600'}).end(bytes);
 }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port,results=[];
try {
 for(const [engine,type] of Object.entries({chromium,webkit})) {
  const browser=await type.launch();
  try {
   const context=await browser.newContext(),keeper=await context.newPage();await keeper.goto(url+'/cache-setup.html');
   await keeper.evaluate(async paths=>{for(const p of paths){const r=await fetch(p);if(!r.ok)throw Error('Could not prime stale asset');await r.text();}},stale);
   // Keep the priming page as a cache holder; no emulator or old session is open.
   for(const load of ['cold','warm']) {
    const start=requests.length,page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(url+'/cache-setup.html');
    const result=await page.evaluate(async appURL=>{
     const {loadRuntime}=await import(appURL),runtime=await loadRuntime(new AbortController().signal);
     const disk=await runtime.Slop86Disk.create();
     try {await disk.unlock('runtime cache fixture','public compatibility password','main');const info=await disk.createEmpty(16*1048576);return {compatibility:runtime.compatibility,size:info.size};}
     finally {await disk.close();}
    },new URL(appPath,url+'/').href);
    assert.equal(result.size,16*1048576);assert.match(result.compatibility,/^my98-state-adapter-1:/);assert.deepEqual(errors,[]);
    const seen=requests.slice(start);assert(!seen.some(p=>stale.includes(p)),'Unversioned stale runtime requested');
    assert(seen.some(p=>p.includes('/releases/'))||load==='warm','Runtime must load from its versioned graph');
    results.push({engine,load,pass:true,...result,requests:seen});await page.close();
   }
   await context.close();
  }finally{await browser.close();}
 }
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2)+'\n');}
console.log('Versioned runtime with stale cached assets: PASS',results.length,'cases');
