import http from 'node:http';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
export async function serveFuture(root=process.cwd(),instrument=false) {
 const server=http.createServer(async(req,res)=>{
  try {
   const url=new URL(req.url,'http://localhost'),file=path.resolve(root,'.'+url.pathname);
   if(!file.startsWith(path.resolve(root)+path.sep))throw Error('outside root');
   let bytes=await readFile(file);
   if(instrument&&url.pathname==='/future.html')bytes=Buffer.from(bytes.toString().replace('module => module.start()', 'module => { window.session = module.start(); }'));
   res.setHeader('Content-Type',file.endsWith('.html')?'text/html':/\.m?js$/.test(file)?'text/javascript':file.endsWith('.wasm')?'application/wasm':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'application/octet-stream');
   res.setHeader('Cache-Control','no-store');res.end(bytes);
  } catch{res.writeHead(404).end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {url:`http://127.0.0.1:${server.address().port}`,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
