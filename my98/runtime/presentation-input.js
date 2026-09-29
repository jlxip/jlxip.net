// Site-only mouse policy. Direct pointer continues to own guest coordinates and touch.
export function guardPresentationInput({display, unlocked}) {
    let gesture=null, replaying=false;
    const listeners=[];
    const listen=(target,type,handler)=>{
        target.addEventListener(type,handler,true);
        listeners.push(()=>target.removeEventListener(type,handler,true));
    };
    const consume=event=>{event.preventDefault();event.stopImmediatePropagation();};
    function reset() {
        const previous=gesture;gesture=null;
        if(previous && display.hasPointerCapture(previous.id))display.releasePointerCapture(previous.id);
    }
    const lockedMouse=event=>!replaying&&!unlocked()&&event.pointerType==='mouse';
    listen(display,'pointerdown',event=>{
        if(!lockedMouse(event))return;
        consume(event);reset();
        if(event.button!==0||event.buttons!==1)return;
        gesture={id:event.pointerId,x:event.clientX,y:event.clientY,cancelled:false};
        display.setPointerCapture(event.pointerId);
    });
    listen(display,'pointermove',event=>{
        if(!lockedMouse(event)||(!gesture&&!event.buttons))return;
        consume(event);
        if(gesture && (event.buttons!==1||Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y)>8))
            gesture.cancelled=true;
    });
    listen(display,'pointerup',event=>{
        if(!lockedMouse(event))return;
        consume(event);
        const previous=gesture;
        const target=document.elementFromPoint(event.clientX,event.clientY);
        const click=previous?.id===event.pointerId&&!previous.cancelled&&event.button===0&&event.buttons===0&&
            Math.hypot(event.clientX-previous.x,event.clientY-previous.y)<=8&&target&&display.contains(target);
        reset();
        if(!click)return;
        // Send a complete click only after ruling out a drag. Never press a guest
        // button during the gesture, so cancelling cannot open the original link.
        replaying=true;
        try {
            const options={bubbles:true,cancelable:true,pointerId:event.pointerId,pointerType:'mouse',
                isPrimary:true,button:0,clientX:event.clientX,clientY:event.clientY};
            display.dispatchEvent(new PointerEvent('pointerdown',{...options,buttons:1}));
            display.dispatchEvent(new PointerEvent('pointerup',{...options,buttons:0}));
        } finally {replaying=false;}
    });
    for(const type of ['pointercancel','lostpointercapture'])listen(display,type,reset);
    listen(document,'pointerdown',event=>{if(gesture&&event.pointerId!==gesture.id)reset();});
    listen(window,'blur',reset);
    listen(document,'visibilitychange',()=>{if(document.hidden)reset();});
    return {reset,destroy(){reset();for(const remove of listeners)remove();}};
}
