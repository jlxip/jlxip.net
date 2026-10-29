import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium,webkit} from '../my98/node_modules/playwright/index.mjs';
import {serveFuture} from './future-server.mjs';

const root=process.cwd(),output=path.resolve('build/error-details');await mkdir(output,{recursive:true});
const entry=await readFile('my98/index.html','utf8'),config=JSON.parse(await readFile('my98/runtime/config.json','utf8'));
let mode;
const server=await serveFuture(root,false,{config:()=>config,handleRequest(req,res,url){
    if(url.pathname==='/error-harness.html') {
        res.setHeader('Content-Type','text/html');res.end(entry.replace('module => module.start()','module => {window.module=module;}'));return true;
    }
    const unavailable=mode==='bootstrap'&&url.pathname==='/build/future/app.js' ||
        mode==='runtime-import'&&url.pathname.endsWith('/build/disk/web/client.js');
    if(unavailable){res.writeHead(404).end();return true;}
    if(mode==='runtime-asset'&&url.pathname.endsWith('/build/v86.wasm') || mode==='configuration'&&url.pathname==='/build/future/config.json') {
        res.writeHead(503).end();return true;
    }
    if(mode==='invalid-json'&&url.pathname==='/build/future/config.json') {
        res.writeHead(200,{'Content-Type':'application/json'}).end('{');return true;
    }
    return false;
}});
const results=[];
try {
    for(const [engine,type] of Object.entries({chromium,webkit})) {
        const browser=await type.launch();
        try {
            for(mode of ['bootstrap','runtime-asset','runtime-import','configuration','invalid-json',
                'worker','publication','state','restore','prefetch','cleanup','retry','literal']) {
                const page=await browser.newPage({viewport:{width:320,height:600},isMobile:true,hasTouch:true});
                try {
                    await page.goto(server.url+(mode==='bootstrap'?'/':'/error-harness.html'));
                    if(mode!=='bootstrap') {
                        await page.waitForFunction(()=>window.module);
                        await page.evaluate(async mode=>{
                            const session=window.session=new module.FutureSession();
                            const failure=(message,code)=>Object.assign(new Error(message),{code});
                            if(['runtime-asset','runtime-import','configuration','invalid-json'].includes(mode)) {
                                await session.load();return;
                            }
                            if(mode==='literal') {
                                session.showError(new Error('<img src=x onerror=alert(1)>\n'+'Long error '.repeat(1000)),'Reading disk');return;
                            }
                            if(mode==='retry') {
                                session.adapter={failed:true,dispose(){},retry:async()=>{throw new Error('Read retry failed',{cause:failure('Seed timed out','TRANSPORT_TIMEOUT')});}};
                                session.machine={run(){window.resumed=true;},destroy:async()=>{}};
                                await session.retryDisk();return;
                            }
                            const disk={cancel(){},terminate(){if(mode==='cleanup')throw Error('Cleanup failed too');},
                                async openRemoteReadOnly(){
                                    if(mode==='publication')throw failure('Publication lookup timed out','PUBLICATION_UNAVAILABLE');
                                    return {remote:{publicKey:'test',publicationInfoHash:'test',stateInfoHash:'test',sequence:1}};
                                },
                                async waitLoadPrefetch(){throw failure('Startup range timed out','TRANSPORT_TIMEOUT');},
                            };
                            const runtime={Slop86Disk:{async create(){if(mode==='worker')throw failure('Worker startup failed','DISK_WORKER_ERROR');return disk;}},
                                async restoreMachineState(options){
                                    if(mode==='restore')return options.createMachine({},{});
                                    if(mode==='state'||mode==='cleanup')throw failure('Saved state authentication failed','AUTHENTICATION_FAILED');
                                    return {machine:{destroy:async()=>{}},adapter:{dispose(){}},prefetchId:1};
                                },
                            };
                            session.runtime=runtime;session.prepareRuntime=()=>Promise.resolve(runtime);
                            session.createMachine=async()=>{throw new RangeError('Could not allocate Windows memory');};
                            await session.load();
                        },mode);
                    }
                    await page.waitForFunction(()=>document.querySelector('#status').classList.contains('error'));
                    const text=await page.locator('#status').textContent();
                    assert(!text.includes('Something went wrong'),text);
                    const expected={bootstrap:['Loading application failed.','Resource: build/future/app.js'],
                        'runtime-asset':['Loading runtime failed.','HTTP_503','Resource: build/v86.wasm'],
                        'runtime-import':['Loading runtime failed.','Resource: build/disk/web/client.js'],
                        configuration:['Loading configuration failed.','HTTP_503','Resource: build/future/config.json'],
                        'invalid-json':['Loading configuration failed.','SyntaxError:'],worker:['Starting disk worker failed.','DISK_WORKER_ERROR: Worker startup failed'],
                        publication:['Opening publication failed.','PUBLICATION_UNAVAILABLE: Publication lookup timed out'],
                        state:['Loading saved state failed.','AUTHENTICATION_FAILED: Saved state authentication failed'],
                        restore:['Restoring Windows failed.','RangeError: Could not allocate Windows memory'],
                        prefetch:['Loading startup disk blocks failed.','TRANSPORT_TIMEOUT: Startup range timed out'],
                        cleanup:['Loading saved state failed.','AUTHENTICATION_FAILED: Saved state authentication failed'],
                        retry:['Retrying disk read failed.','Read retry failed','Caused by: TRANSPORT_TIMEOUT: Seed timed out'],
                        literal:['Reading disk failed.','<img src=x onerror=alert(1)>']};
                    for(const part of expected[mode])assert(text.includes(part),JSON.stringify({mode,part,text}));
                    assert.equal(await page.locator('#status img').count(),0,'Error text was treated as HTML');
                    assert.equal(await page.locator('#retry').isEnabled(),true);
                    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
                    if(mode==='literal') {
                        const bounds=await page.locator('#loading').boundingBox();assert(bounds.y>=0&&bounds.y+bounds.height<=600);
                        assert(await page.locator('#loading').evaluate(e=>e.scrollHeight>e.clientHeight),'Long errors cannot scroll');
                    }
                    if(mode==='retry') {
                        await page.evaluate(()=>{session.adapter.retry=async()=>{};});await page.locator('#retry').click();
                        await page.waitForFunction(()=>window.resumed);assert.equal(await page.locator('#loading').isVisible(),false);
                    }
                    if(mode==='state')await page.screenshot({path:path.join(output,engine+'-mobile.png')});
                    results.push({engine,mode,passed:true,text:mode==='literal'?'literal + long scrollable message':text});
                    console.log(engine,mode,'PASS');
                }finally{await page.evaluate(()=>window.session?.destroy()).catch(()=>{});await page.close();}
            }
        }finally{await browser.close();}
    }
}finally{await server.close();await writeFile(path.join(output,'browser-results.json'),JSON.stringify(results,null,2)+'\n');}
