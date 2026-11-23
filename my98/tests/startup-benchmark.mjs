import assert from 'node:assert/strict';
import {chromium,webkit} from '../my98/node_modules/playwright/index.mjs';

/** Three independent cold contexts, each followed by its verified-cache load. */
export async function benchmarkStartup({server,results,memoryMiB=512,verifyCpu=false}) {
 for(const [engine,type] of Object.entries({chromium,webkit})) {
  const browser=await type.launch();
  try {
   for(let sample=0;sample<3;sample++) {
    const context=await browser.newContext();
    try {
     for(const cache of ['cold','warm']) {
      const page=await context.newPage(),requests=[];
      page.on('request',request=>requests.push(new URL(request.url()).pathname));
      await page.goto(server.url+'/');
      await page.waitForFunction(()=>window.session&&!session.working,undefined,{timeout:90000});
      assert.equal(await page.locator('#display').isVisible(),true,await page.locator('#status').textContent());
      const value=await page.evaluate(async()=>({metrics:session.attempt.metrics,stats:await session.disk.readStats(),memoryMiB:session.machine.v86.cpu.mem8.length/1048576}));
      assert.equal(value.memoryMiB,memoryMiB);
      if(verifyCpu){const before=await page.evaluate(()=>session.machine.get_instruction_counter());await page.waitForFunction(before=>session.machine.get_instruction_counter()!==before,before,{timeout:5000});}
      assert(!requests.some(path=>/^\/(?:v2|content|fixture\/(?:content|metadata|pieces))\//.test(path)),'Consumer fetched legacy or fixture HTTP payload');
      results.push({benchmark:'startup',engine,sample,cache,...value});
      console.log('BENCHMARK',engine,sample,cache,JSON.stringify(value));
      await page.evaluate(()=>session.destroy());await page.close();
     }
    }finally{await context.close();}
   }
  }finally{await browser.close();}
 }
}
