import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {serveFuture} from './future-server.mjs';
import {benchmarkStartup} from './startup-benchmark.mjs';

// The configured signed publication, complete shipped runtime and real guest CPU.
const output=path.resolve(process.env.EVIDENCE||'build/startup-benchmark-real');
await mkdir(output,{recursive:true});
const server=await serveFuture(path.resolve(process.env.SITE_ROOT||'.'),true),results=[];
try {
 await benchmarkStartup({server,results,memoryMiB:Number(process.env.EXPECTED_MEMORY_MIB||256),verifyCpu:true});
 await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2)+'\n');
 console.log('Signed publication startup benchmark: PASS',results.length,'loads');
}finally{await server.close();}
