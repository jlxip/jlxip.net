// Site-only input policy. Direct pointer continues to own guest coordinates.
export function guardPresentationInput({display, unlocked, getSession=()=>true}) {
    let gesture=null, lastTap=null, replaying=false;
    const touches=new Set(), listeners=[];
    const listen=(target,type,handler)=>{
        target.addEventListener(type,handler,true);
        listeners.push(()=>target.removeEventListener(type,handler,true));
    };
    const consume=event=>{event.preventDefault();event.stopImmediatePropagation();};
    const inside=(x,y)=>{
        const target=document.elementFromPoint(x,y);
        return !!target && display.contains(target);
    };
    function reset({keepTap=false}={}) {
        const previous=gesture;gesture=null;
        if(!keepTap)lastTap=null;
        clearTimeout(previous?.timer);
        if(previous && display.hasPointerCapture(previous.id))display.releasePointerCapture(previous.id);
    }
    function replayClick(previous,button) {
        // The same active pointer ID lets direct pointer retain its normal capture
        // and coordinate mapping. Ignore capture notifications during this replay.
        replaying=true;
        try {
            const options={bubbles:true,cancelable:true,pointerId:previous.id,pointerType:'mouse',
                isPrimary:true,button,clientX:previous.lastX,clientY:previous.lastY};
            display.dispatchEvent(new PointerEvent('pointerdown',{...options,buttons:button===2?2:1}));
            display.dispatchEvent(new PointerEvent('pointerup',{...options,buttons:0}));
        } finally {replaying=false;}
    }
    function replayTap(previous,button) {
        // A few CSS pixels of finger jitter become much larger guest motion on
        // a scaled-down desktop. Anchor a nearby second tap to the first one;
        // Windows still decides whether the two ordinary clicks are a double.
        const tap={x:previous.lastX,y:previous.lastY,time:performance.now(),session:previous.session};
        if(button===0 && lastTap && lastTap.session===tap.session && tap.time-lastTap.time<=500 &&
            Math.hypot(tap.x-lastTap.x,tap.y-lastTap.y)<=8) {
            previous.lastX=lastTap.x;previous.lastY=lastTap.y;lastTap=null;
        } else lastTap=button===0?tap:null;
        replayClick(previous,button);
    }
    const lockedMouse=event=>!replaying&&!unlocked()&&event.pointerType==='mouse';
    const siteTouch=event=>!replaying&&event.pointerType==='touch'&&(unlocked()||gesture?.touch);
    const validTouch=previous=>previous && previous.state==='pending' && unlocked() &&
        previous.session===getSession() && touches.size===1 && inside(previous.lastX,previous.lastY);
    function rightClick(previous) {
        if(gesture!==previous)return;
        clearTimeout(previous.timer);
        lastTap=null;
        if(!validTouch(previous)){previous.state='cancelled';return;}
        previous.state='executed';
        replayClick(previous,2);
        // Direct pointer releases capture after its complete click. Recapture the
        // still-held finger before the browser processes pending capture changes.
        if(gesture===previous)display.setPointerCapture(previous.id);
    }
    listen(document,'pointerdown',event=>{
        if(replaying)return;
        if(event.pointerType==='touch')touches.add(event.pointerId);
        if(gesture&&event.pointerId!==gesture.id)reset();
    });
    for(const type of ['pointerup','pointercancel'])listen(document,type,event=>{
        if(!replaying&&event.pointerType==='touch')touches.delete(event.pointerId);
    });
    listen(display,'pointerdown',event=>{
        if(siteTouch(event)) {
            consume(event);reset({keepTap:true});
            const session=getSession();
            if(!event.isPrimary||touches.size!==1||!session||!inside(event.clientX,event.clientY)) {
                lastTap=null;return;
            }
            const previous=gesture={id:event.pointerId,touch:true,x:event.clientX,y:event.clientY,
                lastX:event.clientX,lastY:event.clientY,state:'pending',session,started:performance.now()};
            display.setPointerCapture(previous.id);
            previous.timer=setTimeout(()=>rightClick(previous),500);
            return;
        }
        if(!lockedMouse(event))return;
        consume(event);reset();
        if(event.button!==0||event.buttons!==1)return;
        gesture={id:event.pointerId,x:event.clientX,y:event.clientY,cancelled:false};
        display.setPointerCapture(event.pointerId);
    });
    listen(display,'pointermove',event=>{
        if(siteTouch(event)) {
            consume(event);
            if(gesture?.touch&&gesture.id===event.pointerId) {
                gesture.lastX=event.clientX;gesture.lastY=event.clientY;
                if(Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)>8||!validTouch(gesture)) {
                    clearTimeout(gesture.timer);
                    lastTap=null;
                    if(gesture.state==='pending')gesture.state='cancelled';
                }
            }
            return;
        }
        if(!lockedMouse(event)||(!gesture&&!event.buttons))return;
        consume(event);
        if(gesture && (event.buttons!==1||Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)>8))
            gesture.cancelled=true;
    });
    listen(display,'pointerup',event=>{
        if(siteTouch(event)) {
            consume(event);
            const previous=gesture;
            if(!previous?.touch||previous.id!==event.pointerId)return;
            previous.lastX=event.clientX;previous.lastY=event.clientY;
            // The document listener has already removed this finger. No other
            // contacts may remain, and an overdue timer still means a right click.
            const click=previous.state==='pending'&&unlocked()&&previous.session===getSession()&&
                touches.size===0&&inside(event.clientX,event.clientY)&&
                Math.hypot(event.clientX-previous.x,event.clientY-previous.y)<=8;
            const button=performance.now()-previous.started>=500?2:0;
            reset({keepTap:click&&button===0});
            if(click)replayTap(previous,button);
            return;
        }
        if(!lockedMouse(event))return;
        consume(event);
        const previous=gesture;
        const click=previous?.id===event.pointerId&&!previous.cancelled&&event.button===0&&event.buttons===0&&
            Math.hypot(event.clientX-previous.x,event.clientY-previous.y)<=8&&inside(event.clientX,event.clientY);
        reset();
        if(click)replayClick({...previous,lastX:event.clientX,lastY:event.clientY},0);
    });
    for(const type of ['pointercancel','lostpointercapture'])listen(display,type,event=>{
        if(!replaying&&gesture?.id===event.pointerId)reset();
    });
    listen(display,'contextmenu',consume);
    const abandon=()=>{reset();touches.clear();};
    listen(window,'blur',abandon);
    listen(document,'visibilitychange',()=>{if(document.hidden)abandon();});
    return {reset,destroy(){reset();touches.clear();for(const remove of listeners)remove();}};
}
