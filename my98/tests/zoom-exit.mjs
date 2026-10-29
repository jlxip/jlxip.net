import assert from 'node:assert/strict';
import {chromium} from '../my98/node_modules/playwright/index.mjs';
import {serveFuture} from './future-server.mjs';

const server=await serveFuture();
const browser=await chromium.launch();
try {
    // Exercise the shipped CSS rather than maintaining a separate touch policy.
    const entry=await (await fetch(server.url+'/')).text();
    const style=entry.match(/<style>([\s\S]*?)<\/style>/)?.[1];
    assert(style,'the built entry contains the display styles');
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(server.url+'/__zoom-test__');
    await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${style}</style><div id="display"><canvas width="800" height="600"></canvas></div><div id="loading" hidden><p id="status"></p><button id="retry"></button></div>`);
    await page.evaluate(async()=>{
        const {FutureSession}=await import('/build/future/app.js');
        const {setupDirectPointer}=await import('/my98/my98/src/browser/direct-pointer.js');
        window.events=[];window.contacts=[];
        for(const type of ['pointerdown','pointermove','pointercancel','pointerup'])
            document.addEventListener(type,event=>contacts.push({type,pointerType:event.pointerType,x:event.clientX,y:event.clientY,
                inside:document.getElementById('display').contains(event.target)}),true);
        window.session=new FutureSession();
        session.machine={screen_get_aspect_ratio:()=>4/3,is_running:()=>true,mouse_set_enabled:()=>{},
            bus:{send:(type,value)=>events.push({type,value})}};
        session.pointer=setupDirectPointer({display:session.display,
            getSurface:()=>session.display.querySelector('canvas'),getMachine:()=>session.machine});
        session.pointer.activate();events=[];
        session.bridge={exited:false};
        session.fit();window.initialFrame=[...session.frame];
    });
    const cdp=await context.newCDPSession(page);
    await cdp.send('Input.synthesizePinchGesture',{x:300,y:350,scaleFactor:2,gestureSourceType:'touch'});
    await page.waitForFunction(()=>visualViewport.scale>1.9);
    assert.equal(await page.locator('#display').evaluate(element=>element.getBoundingClientRect().width),800,'pinch still magnifies the presentation');
    assert(await page.evaluate(()=>visualViewport.offsetLeft>0),'pinch moved the visible viewport');
    assert.deepEqual(await page.evaluate(()=>events),[],'pinching never reaches the guest');
    const pan=async(axis)=>{
        const before=await page.evaluate(()=>{
            const v=visualViewport,r=session.display.getBoundingClientRect();
            events=[];contacts=[];
            return {x:v.offsetLeft,y:v.offsetTop,maxX:innerWidth-v.width,maxY:innerHeight-v.height,
                width:r.width,height:r.height,left:r.left,top:r.top,
                dx:r.left>(Math.min(v.offsetLeft,v.offsetLeft+v.width-r.width)+Math.max(v.offsetLeft,v.offsetLeft+v.width-r.width))/2?-20:20,
                dy:r.top>(Math.min(v.offsetTop,v.offsetTop+v.height-r.height)+Math.max(v.offsetTop,v.offsetTop+v.height-r.height))/2?-20:20,
                touchX:(Math.max(r.left,v.offsetLeft)+Math.min(r.right,v.offsetLeft+v.width))/2-v.offsetLeft,
                touchY:(Math.max(r.top,v.offsetTop)+Math.min(r.bottom,v.offsetTop+v.height))/2-v.offsetTop};
        });
        const steps=axis==='turn'?[[before.dx,0],[before.dx,before.dy],[0,before.dy],[0,0]]:
            [[axis.includes('x')?before.dx:0,axis.includes('y')?before.dy:0]];
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:before.touchX,y:before.touchY}]});
        let previous=before,previousStep=[0,0];
        for(const step of steps) {
            await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',
                touchPoints:[{x:before.touchX+step[0],y:before.touchY+step[1]}]});
            const current=await page.evaluate(async()=>{
                await new Promise(requestAnimationFrame);
                const r=session.display.getBoundingClientRect();return {left:r.left,top:r.top,contacts};
            });
            if(step[0]!==previousStep[0])assert(Math.abs(current.left-previous.left)>5,`own horizontal pan ${JSON.stringify({before,current,step})}`);
            if(step[1]!==previousStep[1])assert(Math.abs(current.top-previous.top)>5,`own vertical pan ${JSON.stringify({before,current,step})}`);
            previous=current;previousStep=step;
        }
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        const after=await page.evaluate(()=>{
            const v=visualViewport,r=session.display.getBoundingClientRect();
            return {x:v.offsetLeft,y:v.offsetTop,width:r.width,height:r.height,left:r.left,top:r.top,
                events,contacts};
        });
        assert(Math.abs(after.x-before.x)<1&&Math.abs(after.y-before.y)<1,'the browser does not pan the viewport');
        assert.deepEqual(after.events,[],'own panning never reaches the guest');
        assert(after.contacts.some(event=>event.type==='pointerdown'&&event.inside),'gesture begins on the input surface');
        assert.deepEqual([after.width,after.height],[before.width,before.height],'panning preserves the canvas size');
    };
    const tap=async(hold=false)=>{
        const point=await page.evaluate(()=>{
            const v=visualViewport,r=session.display.getBoundingClientRect();
            return {x:(Math.max(r.left,v.offsetLeft)+Math.min(r.right,v.offsetLeft+v.width))/2-v.offsetLeft,
                y:(Math.max(r.top,v.offsetTop)+Math.min(r.bottom,v.offsetTop+v.height))/2-v.offsetTop};
        });
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
        if(hold)await page.waitForFunction(()=>events.some(e=>e.type==='mouse-click'&&e.value[2]));
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    };
    const checkClicks=async(expected)=>{
        const result=await page.evaluate(()=>{
            const r=session.display.getBoundingClientRect();
            const contact=contacts.find(e=>e.type==='pointerdown'&&e.pointerType==='touch');
            return {events,contact,point:contact&&[contact.x-r.left,contact.y-r.top,r.width,r.height]};
        });
        assert(result.contact?.inside,'tap hits the visible display');
        assert.deepEqual(result.events.filter(e=>e.type==='mouse-click').map(e=>e.value),expected);
        assert(!result.events.some(e=>e.type==='mouse-wheel'),'tap does not send wheel events');
        const positions=result.events.filter(e=>e.type==='mouse-absolute');
        assert(positions.length>0);
        for(const {value} of positions)for(let i=0;i<4;i++)
            assert(Math.abs(value[i]-result.point[i])<1,'click uses the visible, panned canvas coordinates');
    };
    for(const axis of ['x','y','xy','turn'])await pan(axis);
    await page.evaluate(()=>{events=[];contacts=[];});await tap();
    await checkClicks([[true,false,false],[false,false,false]]);
    await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});
    await page.waitForFunction(()=>visualViewport.scale===1&&session.frame.every((value,index)=>value===initialFrame[index]));
    await page.evaluate(()=>{events=[];contacts=[];});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:100,y:300}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:130,y:330}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    assert(await page.evaluate(()=>session.frame.every((value,index)=>value===initialFrame[index])),'unzoomed presentation does not pan');
    assert.deepEqual(await page.evaluate(()=>events),[]);
    await cdp.send('Input.synthesizePinchGesture',{x:300,y:350,scaleFactor:2,gestureSourceType:'touch'});
    await page.waitForFunction(()=>visualViewport.scale>1.9);
    await page.evaluate(()=>{session.bridge.exited=true;session.fit();});
    const frame=()=>page.evaluate(()=>{
        const rect=document.querySelector('#display').getBoundingClientRect(),viewport=visualViewport;
        return {centerX:rect.x+rect.width/2,centerY:rect.y+rect.height/2,
            visualCenterX:viewport.offsetLeft+viewport.width/2,visualCenterY:viewport.offsetTop+viewport.height/2,
            width:rect.width,height:rect.height,visibleWidth:viewport.width,visibleHeight:viewport.height};
    });
    const zoomed=await frame();
    assert(Math.abs(zoomed.centerX-zoomed.visualCenterX)<1);
    assert(Math.abs(zoomed.centerY-zoomed.visualCenterY)<1);
    assert(zoomed.width<=zoomed.visibleWidth+1 && zoomed.height<=zoomed.visibleHeight+1,'desktop fits in the visible viewport');
    // Enlarge the newly fitted desktop before testing navigation after Exit.
    const center=await page.evaluate(()=>({x:visualViewport.width/2,y:visualViewport.height/2}));
    await cdp.send('Input.synthesizePinchGesture',{...center,scaleFactor:1.5,gestureSourceType:'touch'});
    for(const axis of ['x','y','xy','turn'])await pan(axis);
    const scale=await page.evaluate(()=>visualViewport.scale);
    await page.evaluate(()=>{events=[];contacts=[];});await tap();await tap();
    await checkClicks([[true,false,false],[false,false,false],[true,false,false],[false,false,false]]);
    assert.equal(await page.evaluate(()=>visualViewport.scale),scale,'double tap clicks without zooming');
    await page.evaluate(()=>{events=[];contacts=[];});await tap(true);
    await checkClicks([[false,false,true],[false,false,false]]);
    await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});
    await page.waitForFunction(()=>{
        const rect=document.querySelector('#display').getBoundingClientRect();
        return visualViewport.scale===1 && Math.abs(rect.width-innerWidth)<1;
    });
    const unzoomed=await frame();
    assert(Math.abs(unzoomed.centerX-195)<1);
    assert(Math.abs(unzoomed.centerY-422)<1);
    assert.deepEqual(errors,[]);
    console.log('mobile own pan (8 gestures, including turns/reversals), taps, double tap, long press, native zoom and Exit framing PASS');
} finally {await browser.close();await server.close();}
