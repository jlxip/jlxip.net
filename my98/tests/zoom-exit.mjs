import assert from 'node:assert/strict';
import {chromium} from '../my98/node_modules/playwright/index.mjs';
import {serveFuture} from './future-server.mjs';

const server=await serveFuture();
const browser=await chromium.launch();
try {
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(server.url+'/__zoom-test__');
    await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;overflow:hidden}#display{position:fixed;left:0;top:0;touch-action:pinch-zoom}canvas{display:block;width:100%;height:100%}</style><div id="display"><canvas width="800" height="600"></canvas></div><div id="loading"><p id="status"></p><button id="retry"></button></div>');
    await page.evaluate(async()=>{
        const {FutureSession}=await import('/build/future/app.js');
        window.session=new FutureSession();
        session.machine={screen_get_aspect_ratio:()=>4/3};
        session.bridge={exited:false};
        session.fit();
    });
    const cdp=await context.newCDPSession(page);
    await cdp.send('Input.synthesizePinchGesture',{x:300,y:350,scaleFactor:2,gestureSourceType:'touch'});
    await page.waitForFunction(()=>visualViewport.scale>1.9);
    assert.equal(await page.locator('#display').evaluate(element=>element.getBoundingClientRect().width),800,'pinch still magnifies the presentation');
    await page.evaluate(()=>{session.bridge.exited=true;session.fit();});
    const frame=()=>page.evaluate(()=>{
        const rect=document.querySelector('#display').getBoundingClientRect(),viewport=visualViewport;
        return {centerX:rect.x+rect.width/2,centerY:rect.y+rect.height/2,
            visualCenterX:viewport.offsetLeft+viewport.width/2,visualCenterY:viewport.offsetTop+viewport.height/2,
            width:rect.width,height:rect.height,visibleWidth:viewport.width,visibleHeight:viewport.height};
    });
    const zoomed=await frame();
    assert(zoomed.visualCenterX>195,'pinch moved the visible viewport');
    assert(Math.abs(zoomed.centerX-zoomed.visualCenterX)<1);
    assert(Math.abs(zoomed.centerY-zoomed.visualCenterY)<1);
    assert(zoomed.width<=zoomed.visibleWidth+1 && zoomed.height<=zoomed.visibleHeight+1,'desktop fits in the visible viewport');
    await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});
    await page.waitForFunction(()=>{
        const rect=document.querySelector('#display').getBoundingClientRect();
        return visualViewport.scale===1 && Math.abs(rect.width-innerWidth)<1;
    });
    const unzoomed=await frame();
    assert(Math.abs(unzoomed.centerX-195)<1);
    assert(Math.abs(unzoomed.centerY-422)<1);
    assert.deepEqual(errors,[]);
    console.log('mobile zoom and Exit framing PASS');
} finally {await browser.close();await server.close();}
