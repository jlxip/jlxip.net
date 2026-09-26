import {CID} from 'multiformats/cid';
import {publicKeyFromMultihash} from '@libp2p/crypto/keys';
import {resolveIpns} from '../../my98/src/disk/web/resolution.js';
import {attachMatrixBridge} from '../scripts/exit-matrix/bridge.js';
import {guardPresentationInput} from './presentation-input.js';

const runtimeURL = path => new URL('../my98-runtime/' + path, import.meta.url);
// Content bounds (with breathing room) of the published 800×600 IE home page.
// Revisit these bounds if the guest page is redesigned; other resolutions fit in full.
const PRESENTATION = Object.freeze({width:800,height:600,left:8,top:152,right:208,bottom:448});
// Keep the pointer away from IE's and Windows' auto-hide edges while presenting.
const PRESENTATION_EDGE_CROP = 8;
const abortError = () => Object.assign(new Error('Loading cancelled'), {code:'CANCELLED'});
const check = signal => {if(signal.aborted) throw abortError();};
async function readAsset(path, signal) {
    const response = await fetch(runtimeURL(path), {signal});
    if(!response.ok) throw new Error('The Windows runtime could not be loaded.');
    return response.arrayBuffer();
}
export async function loadRuntime(signal) {
    const [engine, disk, state, pointer, ...bytes] = await Promise.all([
        import(runtimeURL('build/libv86.mjs')),
        import(runtimeURL('build/disk/web/client.js')),
        import(runtimeURL('src/browser/machine-state.js')),
        import(runtimeURL('src/browser/direct-pointer.js')),
        ...['build/libv86.mjs','build/v86.wasm','bios/seabios.bin','bios/bochs-vgabios.bin'].map(p=>readAsset(p,signal)),
    ]);
    check(signal);
    const [hashes,module]=await Promise.all([
        Promise.all(bytes.map(async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join(''))),
        WebAssembly.compile(bytes[1]),
    ]);check(signal);
    return {...engine,...disk,...state,...pointer,module,bios:bytes[2],vgaBios:bytes[3],compatibility:'my98-state-adapter-1:'+hashes.join(':')};
}
export async function resolvePublication(ipnsName, signal, onCandidate) {
    const publicKey=publicKeyFromMultihash(CID.parse(ipnsName).multihash).raw;
    const validate=resolved=>{
        if(resolved.path!=='/ipfs/'+resolved.rootCid)throw new Error('The publication must point to a disk and state directory.');
        return resolved;
    };
    return validate(await resolveIpns({ipnsName,publicKey},{signal,deadlineMs:5000,
        onCandidate:resolved=>onCandidate?.(validate(resolved)),
    }));
}
function errorMessage(error) {
    console.error('Could not complete the request',error);
    return 'Something went wrong. Please try again.';
}

export class FutureSession {
    constructor() {
        this.runtimeAbort=new AbortController();this.attemptQueue=Promise.resolve();
        this.display=document.getElementById('display');
        this.panel=document.getElementById('loading');
        this.message=document.getElementById('status');
        this.retry=document.getElementById('retry');
        this.retry.onclick=()=>this.adapter?.failed ? this.retryDisk() : this.load();
        this.resize=()=>this.fit();window.addEventListener('resize',this.resize);
        this.gesture=()=>{this.machine?.speaker_adapter?.resume();};
        this.display.addEventListener('pointerdown',this.gesture,true);
        this.input=guardPresentationInput({display:this.display,unlocked:()=>!!this.bridge?.exited});
        this.leave=()=>{void this.destroy();};window.addEventListener('pagehide',this.leave);
    }
    status(text, error=false) {
        this.message.textContent=text;this.panel.hidden=!text;
        this.message.classList.toggle('error',error);
        this.retry.hidden=!error;this.retry.disabled=this.working;
    }
    fit() {
        const canvas=this.display.querySelector('canvas');if(!canvas||!this.machine)return;
        const W=innerWidth,H=innerHeight;if(W<=0||H<=0||!canvas.width||!canvas.height)return;
        const aspect=this.machine.screen_get_aspect_ratio() || canvas.width/canvas.height;
        let width=Math.min(W,H*aspect),height=width/aspect;
        let left=(W-width)/2,top=(H-height)/2;
        let edgeCrop=0;
        const p=PRESENTATION;
        if(!this.bridge?.exited && canvas.width===p.width && canvas.height===p.height) {
            edgeCrop=PRESENTATION_EDGE_CROP;
            const margin=Math.min(24,W/4,H/4);
            const scale=Math.min(Math.max(1,Math.min(W/p.width,H/p.height)),
                (W-2*margin)/(p.right-p.left),(H-2*margin)/(p.bottom-p.top));
            width=p.width*scale;height=p.height*scale;
            left=Math.max((W-width)/2,margin-p.left*scale);top=(H-height)/2;
        }
        const frame=[width,height,left,top,edgeCrop];
        if(!this.frame || frame.some((value,index)=>value!==this.frame[index])) {
            this.input.reset();this.pointer?.release();
        }
        this.frame=frame;
        this.display.style.width=width+'px';this.display.style.height=height+'px';
        this.display.style.left=left+'px';this.display.style.top=top+'px';
        // Clip the input surface too; the full canvas rect still maps guest coordinates.
        this.display.style.clipPath=edgeCrop ? `inset(${100*edgeCrop/canvas.height}% 0)` : 'none';
        const scaleX=width/canvas.width,scaleY=height/canvas.height;
        canvas.style.imageRendering=Number.isInteger(scaleX)&&Number.isInteger(scaleY)?'pixelated':'auto';
    }
    async createMachine(adapter,config,container,signal) {
        const r=this.runtime;
        let rejectInitialization;
        const vm=new r.V86({
            wasm_fn:async imports=>{
                try{return (await WebAssembly.instantiate(r.module,imports)).exports;}
                catch(error){queueMicrotask(()=>rejectInitialization?.(error));return new Promise(()=>{});}
            },
            memory_size:config.memory_size,vga_memory_size:config.vga_memory_size,
            bios:{buffer:r.bios},vga_bios:{buffer:r.vgaBios},hda:{disk_adapter:adapter},
            boot_order:config.boot_order,acpi:config.acpi,
            net_device:{type:'ne2k',relay_url:'wss://relay.widgetry.org/',mtu:1500},
            screen:{container,use_graphical_text:true},disable_speaker:false,
            disable_keyboard:false,autostart:false,
        });
        try {
            await new Promise((resolve,reject)=>{
                const timer=setTimeout(()=>finish(new Error('Windows initialization timed out.')),30000);
                const loaded=()=>finish(),failed=e=>finish(new Error(e.file_name||'Windows initialization failed.'));
                const abort=()=>finish(abortError());
                function finish(error){clearTimeout(timer);signal.removeEventListener('abort',abort);vm.remove_listener('emulator-loaded',loaded);vm.remove_listener('download-error',failed);error?reject(error):resolve();}
                rejectInitialization=finish;
                vm.add_listener('emulator-loaded',loaded);vm.add_listener('download-error',failed);
                signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
            });
            return vm;
        } catch(error) {await vm.destroy().catch(()=>{});throw error;}
    }
    prepareRuntime() {
        if(!this.runtimePromise) {
            this.runtimePromise=loadRuntime(this.runtimeAbort.signal).then(runtime=>this.runtime=runtime).catch(error=>{
                this.runtimePromise=undefined;throw error;
            });
        }
        return this.runtimePromise;
    }
    cancelAttempt() {
        this.attempt?.controller.abort();
        this.attempt?.disk?.cancel();this.attempt?.disk?.terminate();
        this.pointer?.release();this.display.hidden=true;
    }
    async disposeSession() {
        this.input.reset();
        this.bridge?.destroy();this.bridge=undefined;
        this.pointer?.destroy();this.pointer=undefined;
        this.observer?.disconnect();this.observer=undefined;
        const machine=this.machine,adapter=this.adapter,disk=this.disk;
        this.machine=this.adapter=this.disk=undefined;
        this.frame=undefined;this.display.replaceChildren();this.display.hidden=true;
        adapter?.dispose();disk?.terminate();
        if(machine)await machine.destroy().catch(()=>{});
    }
    async load() {
        if(this.working || this.destroyed)return;
        this.working=true;this.abort=new AbortController();const signal=this.abort.signal;
        this.timings={started:performance.now(),attempts:[]};
        this.status('One moment…');
        try {
            this.cancelAttempt();await this.attemptQueue;await this.disposeSession();check(signal);
            this.attempt=undefined;this.publication=undefined;
            this.timings.runtimeStart=performance.now()-this.timings.started;
            const runtime=this.prepareRuntime().then(value=>{
                this.timings.runtimeReady=performance.now()-this.timings.started;return value;
            });
            // Config/resolution can fail before the runtime is awaited.
            runtime.catch(()=>{});
            const response=await fetch(new URL('./config.json',import.meta.url),{signal,cache:'no-store'});
            if(!response.ok)throw new Error('The site configuration could not be loaded.');
            const config=await response.json();check(signal);
            if(typeof config.readKey==='string' && config.readKey.startsWith('my98-ro-v1.'))throw new Error('This read key is outdated. Export a new read-only key.');
            const select=publication=>{
                check(signal);
                if(this.publication?.rootCid===publication.rootCid) {this.publication=publication;return;}
                this.cancelAttempt();this.publication=publication;
                const attempt={controller:new AbortController(),metrics:{cid:publication.rootCid,selected:performance.now()-this.timings.started,phases:{}}};
                this.attempt=attempt;this.timings.attempts.push(attempt.metrics);
                // Serialize teardown/restoration while selection remains immediate.
                this.attemptQueue=this.attemptQueue.then(async()=>{
                    check(signal);check(attempt.controller.signal);
                    await this.disposeSession();check(attempt.controller.signal);
                    await runtime;check(signal);check(attempt.controller.signal);
                    await this.restorePublication(publication,config,attempt);
                }).catch(async error=>{
                    if(attempt.controller.signal.aborted || signal.aborted)return;
                    attempt.metrics.error=errorMessage(error);await this.disposeSession();
                    if(this.attempt===attempt && !signal.aborted)this.status(attempt.metrics.error,true);
                });
            };
            this.timings.resolutionStart=performance.now()-this.timings.started;
            const final=await resolvePublication(config.ipnsName,signal,select);check(signal);
            select(final);this.timings.resolutionFinal=performance.now()-this.timings.started;
            await this.attemptQueue;check(signal);
        } catch(error) {
            this.cancelAttempt();await this.attemptQueue;await this.disposeSession();
            if(!signal.aborted) {this.status(errorMessage(error),true);}
        } finally {this.working=false;this.retry.disabled=false;}
    }
    async restorePublication(publication,config,attempt) {
        const signal=attempt.controller.signal;let restored;
        this.status('Getting things ready…');
        try {
            const publicKey=publicKeyFromMultihash(CID.parse(config.ipnsName).multihash).raw;
            const readPublicKey=this.runtime.readOnlyPublicKey(config.readKey);
            if(publicKey.length!==readPublicKey.length || !publicKey.every((byte,i)=>byte===readPublicKey[i]))
                throw new Error('The site’s read-only credential belongs to a different IPNS identity.');
            this.disk=await this.runtime.Slop86Disk.create({onProgress:p=>{
                if(signal.aborted)return;
                const phase=attempt.metrics.phases[p.phase]||={first:performance.now()-this.timings.started};
                Object.assign(phase,{last:performance.now()-this.timings.started,completed:p.completed,total:p.total});
                if(['download-state','decrypt-state','decompress'].includes(p.phase))this.status('Getting things ready…');
            }});check(signal);
            attempt.disk=this.disk;check(signal);
            const description=await this.disk.openReadOnly({cid:publication.rootCid,readKey:config.readKey,prefetch:{enabled:false},preloadState:true,persistentCache:{state:true,loadProfile:true}});check(signal);
            if(!description.remote?.stateCid)throw new Error('The latest publication has no saved state.');
            this.status('Getting things ready…');
            const container=document.createElement('div');container.innerHTML='<div></div><canvas></canvas>';
            attempt.metrics.opened=performance.now()-this.timings.started;
            restored=await this.runtime.restoreMachineState({disk:this.disk,input:{published:true},compatibility:this.runtime.compatibility,signal,
                createMachine:(adapter,machineConfig)=>{attempt.metrics.prepared=performance.now()-this.timings.started;this.status('Almost there…');return this.createMachine(adapter,machineConfig,container,signal);},
                onDiskError:async error=>{
                    if(signal.aborted)return;
                    if(this.machine){this.pointer?.release();await this.machine.stop();}
                    if(!signal.aborted)this.status(errorMessage(error),true);
                },
            });
            check(signal);
            attempt.metrics.restored=performance.now()-this.timings.started;
            this.machine=restored.machine;this.adapter=restored.adapter;
            this.display.replaceChildren(...container.childNodes);
            this.display.querySelector('canvas').id='vga';
            this.pointer=this.runtime.setupDirectPointer({display:this.display,getSurface:()=>this.display.querySelector('canvas'),getMachine:()=>this.machine,focus:()=>this.display.focus({preventScroll:true})});
            this.bridge=attachMatrixBridge({machine:this.machine,surface:this.display.querySelector('canvas'),pointer:this.pointer,
                onExit:()=>{
                    if(signal.aborted)return;
                    this.fit();this.display.focus({preventScroll:true});
                },onError:error=>{if(!signal.aborted)this.status(errorMessage(error),true);}});
            this.machine.add_listener('screen-set-size',this.resize);
            this.observer=new MutationObserver(this.resize);this.observer.observe(this.display.querySelector('canvas'),{attributes:true,attributeFilter:['width','height']});
            await this.disk.setLoadPrefetch({origin:'restored',scope:'profile'});check(signal);
            this.machine.run();
            // Let the restored VGA frame render before exposing the surface.
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));check(signal);
            if(this.adapter.failed)throw this.adapter.error;
            this.display.hidden=false;this.fit();this.status('');
            attempt.metrics.visible=performance.now()-this.timings.started;
        } catch(error) {
            if(restored && this.machine!==restored.machine) {await restored.machine.destroy().catch(()=>{});restored.adapter.dispose();}
            await this.disposeSession();throw error;
        }
    }
    async retryDisk() {
        if(this.working||this.destroyed)return;
        this.working=true;this.status('One moment…');
        try{await this.adapter.retry();if(this.destroyed)return;this.machine.run();this.status('');}
        catch(error){if(!this.destroyed)this.status(errorMessage(error),true);}
        finally{this.working=false;this.retry.disabled=false;}
    }
    async destroy() {
        if(this.destroyed)return;this.destroyed=true;this.abort?.abort();this.runtimeAbort.abort();
        this.cancelAttempt();
        window.removeEventListener('resize',this.resize);window.removeEventListener('pagehide',this.leave);
        this.display.removeEventListener('pointerdown',this.gesture,true);this.retry.onclick=null;
        this.input.destroy();
        await this.attemptQueue;await this.disposeSession();
    }
}
export function start() {
    const session=new FutureSession();session.ready=session.load();return session;
}
