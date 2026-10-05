import assert from 'node:assert/strict';
import {test} from 'node:test';
import {guardPresentationInput} from '../runtime/presentation-input.js';
import {setupDirectPointer} from '../my98/src/browser/direct-pointer.js';

// Exercise the real site policy AND direct pointer, without a browser or UI.
// Capture changes are deferred, as in a browser; an up event still has an active
// pointer with zero buttons until its dispatch finishes. This harness cannot
// establish native pinch/callout behaviour on a physical phone.
function fixture(t) {
    let now=0, nextTimer=0, session={}, running=true, exited=true;
    const timers=new Map(), active=new Map(), pending=new Set(), captured=new Set(), events=[];
    const saved=new Map();
    const replace=(name,value)=>{
        saved.set(name,Object.getOwnPropertyDescriptor(globalThis,name));
        Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
    };
    class Pointer extends Event {
        constructor(type,options={}) {
            super(type,options);
            const {bubbles,cancelable,composed,...properties}=options;
            Object.assign(this,properties);
        }
    }
    class Surface extends EventTarget {
        constructor(parent=null) {super();this.parent=parent;this.style={};}
        dispatchEvent(event) {
            if(event.bubbles&&this.parent)this.parent.dispatchEvent(event);
            return super.dispatchEvent(event);
        }
        contains(target) {return target===this;}
        hasPointerCapture(id) {return pending.has(id);}
        setPointerCapture(id) {
            if(!active.has(id))throw new Error('Cannot capture an inactive pointer');
            if(active.get(id).buttons)pending.add(id);
        }
        releasePointerCapture(id) {pending.delete(id);}
        getBoundingClientRect() {return {left:100,top:50,width:200,height:150};}
    }
    const doc=new Surface(), win=new Surface(), display=new Surface(doc);
    doc.hidden=false;doc.pointerLockElement=null;
    doc.elementFromPoint=(x,y)=>x>=100&&x<300&&y>=50&&y<200?display:null;
    replace('document',doc);replace('window',win);replace('PointerEvent',Pointer);replace('MouseEvent',Pointer);
    replace('performance',{now:()=>now});
    replace('setTimeout',(callback,delay)=>{const id=++nextTimer;timers.set(id,{callback,due:now+delay});return id;});
    replace('clearTimeout',id=>timers.delete(id));
    const flushCapture=()=>{
        for(const id of new Set([...captured,...pending])) {
            const had=captured.has(id), has=pending.has(id);
            if(has)captured.add(id);else captured.delete(id);
            if(had&&!has)display.dispatchEvent(new Pointer('lostpointercapture',{pointerId:id}));
        }
    };
    // Match FutureSession's native zoom bypass, installed before either policy.
    for(const type of ['touchstart','touchmove','touchend','touchcancel'])
        display.addEventListener(type,event=>event.stopImmediatePropagation(),true);
    const guard=guardPresentationInput({display,unlocked:()=>exited,getSession:()=>running?session:null});
    const vm={bus:{send:(type,value)=>events.push({type,value})},is_running:()=>running,mouse_set_enabled:()=>{}};
    const pointer=setupDirectPointer({display,getSurface:()=>display,getMachine:()=>vm});
    pointer.activate();events.length=0;
    t.after(()=>{
        guard.destroy();pointer.destroy();
        for(const [name,descriptor] of saved) {
            if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];
        }
    });
    function emit(type,options={},outside=false) {
        const values={bubbles:true,cancelable:true,pointerId:2,pointerType:'touch',isPrimary:true,
            clientX:150,clientY:100,button:0,buttons:type==='pointerup'||type==='pointercancel'?0:1,...options};
        if(type==='pointerdown')active.set(values.pointerId,values);
        if(active.has(values.pointerId))active.set(values.pointerId,values);
        const event=new Pointer(type,values);
        (outside?doc:display).dispatchEvent(event);
        if(type==='pointerup'||type==='pointercancel') {
            if(values.pointerType==='touch')active.delete(values.pointerId);
            pending.delete(values.pointerId);
        }
        flushCapture();return event;
    }
    function advance(ms,runTimers=true) {
        const end=now+ms;
        if(runTimers)for(;;) {
            const entry=[...timers].sort((a,b)=>a[1].due-b[1].due)[0];
            if(!entry||entry[1].due>end)break;
            now=Math.max(now,entry[1].due);timers.delete(entry[0]);entry[1].callback();flushCapture();
        }
        now=end;
    }
    return {emit,advance,events,display,doc,win,guard,pointer,timers,pending,
        buttons:()=>events.filter(e=>e.type==='mouse-click').map(e=>e.value),
        positions:()=>events.filter(e=>e.type==='mouse-absolute').map(e=>e.value),
        exit:value=>exited=value,stop:()=>running=false,replace:()=>session={},
        loseCapture:()=>{pending.clear();flushCapture();}};
}
const left=[[true,false,false],[false,false,false]],right=[[false,false,true],[false,false,false]];

test('short tap clicks left on release using scaled, offset coordinates',t=>{
    const f=fixture(t);f.emit('pointerdown');f.advance(499);assert.deepEqual(f.buttons(),[]);
    f.emit('pointerup');assert.deepEqual(f.buttons(),left);
    assert.deepEqual(f.positions(),[[50,50,200,150],[50,50,200,150]]);
    f.advance(1000);assert.deepEqual(f.buttons(),left);assert.equal(f.timers.size,0);
});
test('500 ms clicks right at latest position; holding/releasing never adds left',t=>{
    const f=fixture(t);f.emit('pointerdown');f.emit('pointermove',{clientX:158});
    f.advance(499);assert.deepEqual(f.buttons(),[]);f.advance(1);
    assert.deepEqual(f.buttons(),right);assert.deepEqual(f.positions(),[[58,50,200,150],[58,50,200,150]]);
    assert.equal(f.pending.has(2),true,'capture survives complete synthetic click');
    f.advance(2000);f.emit('pointerup',{clientX:158});assert.deepEqual(f.buttons(),right);
    assert.equal(f.pending.size,0);
});
test('release at an overdue deadline is right even if timer dispatch was delayed',t=>{
    const f=fixture(t);f.emit('pointerdown');f.advance(500,false);f.emit('pointerup');
    assert.deepEqual(f.buttons(),right);f.advance(1000);assert.deepEqual(f.buttons(),right);
});
for(const pointerType of ['touch','mouse'])test(`two quick ${pointerType} clicks retain both press/release pairs`,t=>{
    const f=fixture(t),options={pointerType,pointerId:2};
    f.emit('pointerdown',options);f.advance(30);f.emit('pointerup',options);
    f.advance(100);f.emit('pointerdown',{...options,pointerId:3});f.advance(30);
    f.emit('pointerup',{...options,pointerId:3});
    assert.deepEqual(f.buttons(),[...left,...left]);
    assert.deepEqual(f.positions(),Array(4).fill([50,50,200,150]));
});
test('nearby double tap tolerates finger jitter without extra clicks or delaying the first',t=>{
    const f=fixture(t);f.emit('pointerdown');f.advance(20);f.emit('pointerup');
    assert.deepEqual(f.buttons(),left);
    f.advance(150);f.emit('pointerdown',{pointerId:3,clientX:158});f.advance(20);
    f.emit('pointerup',{pointerId:3,clientX:158});
    assert.deepEqual(f.buttons(),[...left,...left]);
    assert.deepEqual(f.positions(),Array(4).fill([50,50,200,150]));
});
for(const scenario of ['distant','slow','long','cancel','reset','session'])
    test(`${scenario} taps do not reuse an earlier tap position`,t=>{
        const f=fixture(t);f.emit('pointerdown');f.emit('pointerup');
        let x=158;
        switch(scenario) {
            case 'distant':x=159;break;
            case 'slow':f.advance(501);break;
            case 'long':f.emit('pointerdown');f.advance(500);f.emit('pointerup');break;
            case 'cancel':f.emit('pointerdown');f.emit('pointermove',{clientX:159});f.emit('pointerup');break;
            case 'reset':f.guard.reset();break;
            case 'session':f.replace();break;
        }
        f.emit('pointerdown',{clientX:x});f.emit('pointerup',{clientX:x});
        assert.deepEqual(f.positions().at(-1),[x-100,50,200,150]);
    });
test('a nearby mouse click retains its own coordinates',t=>{
    const f=fixture(t),mouse={pointerType:'mouse',pointerId:1};
    f.emit('pointerdown',mouse);f.emit('pointerup',mouse);f.advance(100);
    f.emit('pointerdown',{...mouse,clientX:158});f.emit('pointerup',{...mouse,clientX:158});
    assert.deepEqual(f.buttons(),[...left,...left]);
    assert.deepEqual(f.positions().at(-1),[58,50,200,150]);
});
test('movement beyond 8 CSS pixels cancels permanently, including a return',t=>{
    const f=fixture(t);f.emit('pointerdown');f.emit('pointermove',{clientX:159});
    f.emit('pointermove');f.advance(1000);f.emit('pointerup');assert.deepEqual(f.buttons(),[]);
});
test('release outside the surface cancels; clipped/non-hit areas never start',t=>{
    const f=fixture(t);f.emit('pointerdown',{clientX:298});f.emit('pointerup',{clientX:302});
    f.emit('pointerdown',{clientX:99});f.advance(500);f.emit('pointerup',{clientX:99});
    assert.deepEqual(f.buttons(),[]);
});
for(const outside of [false,true])test(`second finger ${outside?'outside':'inside'} cancels both fingers`,t=>{
    const f=fixture(t);f.emit('pointerdown');f.advance(400);
    f.emit('pointerdown',{pointerId:3,isPrimary:false},outside);f.advance(1000);
    f.emit('pointerup');f.emit('pointerup',{pointerId:3,isPrimary:false},outside);
    assert.deepEqual(f.buttons(),[]);f.emit('pointerdown');f.advance(500);assert.deepEqual(f.buttons(),right);
});
for(const reason of ['cancel','capture','blur','hidden','reset','stop','replace','destroy'])
    test(`${reason} prevents a pending timer and release from clicking`,t=>{
        const f=fixture(t);f.emit('pointerdown');f.advance(400);
        switch(reason) {
            case 'cancel':f.emit('pointercancel');break;
            case 'capture':f.loseCapture();break;
            case 'blur':f.win.dispatchEvent(new Event('blur'));break;
            case 'hidden':f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));break;
            case 'reset':f.guard.reset();break;
            case 'stop':f.stop();break;
            case 'replace':f.replace();break;
            case 'destroy':f.guard.destroy();f.pointer.destroy();break;
        }
        f.advance(1000);f.emit('pointerup');assert.deepEqual(f.buttons(),[]);assert.equal(f.timers.size,0);
    });
test('focus loss recovers even when the old finger never delivers an up event',t=>{
    const f=fixture(t);f.emit('pointerdown');f.win.dispatchEvent(new Event('blur'));
    f.emit('pointerdown',{pointerId:3});f.advance(500);
    assert.deepEqual(f.buttons(),right);f.emit('pointerup',{pointerId:3});assert.deepEqual(f.buttons(),right);
});
test('before Exit even a long hold retains the existing deferred left tap',t=>{
    const f=fixture(t);f.exit(false);f.emit('pointerdown');f.advance(1000);
    assert.deepEqual(f.buttons(),[]);f.emit('pointerup');assert.deepEqual(f.buttons(),left);
});
test('native touch events are not prevented and browser contextmenu is suppressed',t=>{
    const f=fixture(t);assert.equal(f.emit('touchstart').defaultPrevented,false);
    assert.equal(f.emit('touchmove').defaultPrevented,false);
    assert.equal(f.emit('contextmenu').defaultPrevented,true);
});
test('desktop policy: right/drag blocked before Exit, immediate mouse input after',t=>{
    const f=fixture(t),mouse={pointerType:'mouse',pointerId:1};f.exit(false);
    f.emit('pointerdown',{...mouse,button:2,buttons:2});f.emit('pointerup',{...mouse,button:2});
    f.emit('pointerdown',mouse);f.emit('pointermove',{...mouse,clientX:170});f.emit('pointerup',mouse);
    assert.deepEqual(f.buttons(),[]);
    f.emit('pointerdown',mouse);f.emit('pointerup',mouse);assert.deepEqual(f.buttons(),left);
    f.events.length=0;f.exit(true);f.emit('pointerdown',{...mouse,button:2,buttons:2});
    assert.deepEqual(f.buttons(),[right[0]]);f.emit('pointerup',{...mouse,button:2});assert.deepEqual(f.buttons(),right);
});
