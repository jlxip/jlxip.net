import {createServer} from 'node:http';
import {createReadStream,statSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
export async function serveSite({root='.',headers=true}={}) {
 const base=resolve(root); const server=createServer((req,res)=>{
  try {let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name.endsWith('/'))name+='index.html';const file=resolve(base,'.'+name);if(!file.startsWith(base+sep))throw Error('path');const size=statSync(file).size;
   const types={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.html':'text/html','.css':'text/css'};
   const hdr={'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Accept-Ranges':'bytes'};
   const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);let start=0,end=size-1;if(range){start=+range[1];if(range[2])end=Math.min(+range[2],end);if(start>end){res.writeHead(416).end();return;}hdr['Content-Range']=`bytes ${start}-${end}/${size}`;}
   hdr['Content-Length']=end-start+1;res.writeHead(range?206:200,hdr);createReadStream(file,{start,end}).pipe(res);
  }catch(e){res.writeHead(404).end();}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));return {url:`http://127.0.0.1:${server.address().port}/`,async close(){server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
