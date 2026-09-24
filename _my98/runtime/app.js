import {CID} from 'multiformats/cid';
import {publicKeyFromMultihash} from '@libp2p/crypto/keys';
import {resolveIpns} from '../../my98/src/disk/web/resolution.js';
import {attachMatrixBridge} from '../scripts/exit-matrix/bridge.js';

const runtimeURL = path => new URL('../my98-runtime/' + path, import.meta.url);
// Content bounds (with breathing room) of the published 800×600 IE home page.
// Revisit these bounds if the guest page is redesigned; other resolutions fit in full.
const PRESENTATION = Object.freeze({width:800,height:600,left:8,top:152,right:208,bottom:448});
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
    const hashes=await Promise.all(bytes.map(async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('')));
    const module=await WebAssembly.compile(bytes[1]);check(signal);
    return {...engine,...disk,...state,...pointer,module,bios:bytes[2],vgaBios:bytes[3],compatibility:'my98-state-adapter-1:'+hashes.join(':')};
}
export async function resolvePublication(ipnsName, signal) {
    const publicKey=publicKeyFromMultihash(CID.parse(ipnsName).multihash).raw;
    const resolved=await resolveIpns({ipnsName,publicKey},{signal});
    if(resolved.path!=='/ipfs/'+resolved.rootCid) throw new Error('The publication must point to a disk and state directory.');
    return resolved;
}
function errorMessage(error) {
    if(/outdated.*read.only key/i.test(error.message)) return error.message;
    if(/same emulator and BIOS/.test(error.message)) return 'This state needs a different Windows runtime. Please try again after the site is updated.';
    if(error.code==='INVALID_READ_KEY' || /authenticat|read key|different base|decrypt/i.test(error.message)) return 'This publication could not be opened with the site’s read-only credential.';
    if(error.code==='CORRUPTION') return 'The publication could not be verified. Please try again.';
    if(error.code==='IO_ERROR') return 'The publication could not be downloaded. Check your connection and try again.';
    return error.message || 'Windows could not start. Please try again.';
}

export class FutureSession {
    constructor() {
        this.display=document.getElementById('display');
        this.panel=document.getElementById('loading');
        this.message=document.getElementById('status');
        this.retry=document.getElementById('retry');
        this.retry.onclick=()=>this.adapter?.failed ? this.retryDisk() : this.load();
        this.resize=()=>this.fit();window.addEventListener('resize',this.resize);
        this.gesture=()=>{this.machine?.speaker_adapter?.resume();};
        this.display.addEventListener('pointerdown',this.gesture,true);
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
        const p=PRESENTATION;
        if(!this.bridge?.exited && canvas.width===p.width && canvas.height===p.height) {
            const margin=Math.min(24,W/4,H/4);
            const scale=Math.min(Math.max(1,Math.min(W/p.width,H/p.height)),
                (W-2*margin)/(p.right-p.left),(H-2*margin)/(p.bottom-p.top));
            width=p.width*scale;height=p.height*scale;
            left=Math.max((W-width)/2,margin-p.left*scale);top=(H-height)/2;
        }
        const frame=[width,height,left,top];
        if(!this.frame || frame.some((value,index)=>value!==this.frame[index]))this.pointer?.release();
        this.frame=frame;
        this.display.style.width=width+'px';this.display.style.height=height+'px';
        this.display.style.left=left+'px';this.display.style.top=top+'px';
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
    async disposeSession() {
        this.bridge?.destroy();this.bridge=undefined;
        this.pointer?.destroy();this.pointer=undefined;
        this.observer?.disconnect();this.observer=undefined;
        const machine=this.machine;this.machine=undefined;
        if(machine)await machine.destroy().catch(()=>{});
        this.adapter?.dispose();this.adapter=undefined;
        this.disk?.terminate();this.disk=undefined;
        this.frame=undefined;
        this.display.replaceChildren();this.display.hidden=true;
    }
    async load() {
        if(this.working || this.destroyed)return;
        this.working=true;this.abort=new AbortController();const signal=this.abort.signal;
        this.status('Finding the latest publication…');
        let restored;
        try {
            await this.disposeSession();check(signal);
            const response=await fetch(new URL('./config.json',import.meta.url),{signal,cache:'no-store'});
            if(!response.ok)throw new Error('The site configuration could not be loaded.');
            const config=await response.json();
            if(typeof config.readKey==='string' && config.readKey.startsWith('my98-ro-v1.'))throw new Error('This read key is outdated. Export a new read-only key.');
            const publication=await resolvePublication(config.ipnsName,signal);check(signal);
            this.publication=publication;
            this.runtime=await loadRuntime(signal);check(signal);
            const publicKey=publicKeyFromMultihash(CID.parse(config.ipnsName).multihash).raw;
            const readPublicKey=this.runtime.readOnlyPublicKey(config.readKey);
            if(publicKey.length!==readPublicKey.length || !publicKey.every((byte,i)=>byte===readPublicKey[i]))
                throw new Error('The site’s read-only credential belongs to a different IPNS identity.');
            this.disk=await this.runtime.Slop86Disk.create({onProgress:p=>{
                if(signal.aborted)return;
                if(['download-state','decrypt-state','decompress'].includes(p.phase))this.status('Loading the saved state…');
            }});check(signal);
            const description=await this.disk.openReadOnly({cid:publication.rootCid,readKey:config.readKey,prefetch:{enabled:false}});check(signal);
            if(!description.remote?.stateCid)throw new Error('The latest publication has no saved state.');
            this.status('Loading the saved state…');
            const container=document.createElement('div');container.innerHTML='<div></div><canvas></canvas>';
            restored=await this.runtime.restoreMachineState({disk:this.disk,input:{published:true},compatibility:this.runtime.compatibility,signal,
                createMachine:(adapter,machineConfig)=>{this.status('Preparing Windows…');return this.createMachine(adapter,machineConfig,container,signal);},
                onDiskError:async error=>{
                    if(this.machine){this.pointer?.release();await this.machine.stop();}
                    if(!signal.aborted)this.status('Windows paused: '+errorMessage(error),true);
                },
            });
            check(signal);
            this.machine=restored.machine;this.adapter=restored.adapter;
            this.display.replaceChildren(...container.childNodes);
            this.display.querySelector('canvas').id='vga';
            this.pointer=this.runtime.setupDirectPointer({display:this.display,getSurface:()=>this.display.querySelector('canvas'),getMachine:()=>this.machine,focus:()=>this.display.focus({preventScroll:true})});
            this.bridge=attachMatrixBridge({machine:this.machine,surface:this.display.querySelector('canvas'),pointer:this.pointer,
                onExit:()=>{
                    this.fit();this.display.focus({preventScroll:true});
                    void this.disk.setLoadPrefetch({origin:'restored',scope:'disk'}).catch(error=>console.warn('Could not extend disk prefetch',error));
                },onError:error=>this.status(errorMessage(error),true)});
            this.machine.add_listener('screen-set-size',this.resize);
            this.observer=new MutationObserver(this.resize);this.observer.observe(this.display.querySelector('canvas'),{attributes:true,attributeFilter:['width','height']});
            await this.disk.setLoadPrefetch({origin:'restored',scope:'profile'});check(signal);
            this.machine.run();
            // Let the restored VGA frame render before exposing the surface.
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));check(signal);
            if(this.adapter.failed)throw this.adapter.error;
            this.display.hidden=false;this.fit();this.status('');
        } catch(error) {
            if(restored && this.machine!==restored.machine){await restored.machine.destroy().catch(()=>{});restored.adapter.dispose();}
            await this.disposeSession();
            if(!signal.aborted){console.error('Could not load the published state',error);this.status(errorMessage(error),true);}
        } finally {this.working=false;this.retry.disabled=false;}
    }
    async retryDisk() {
        if(this.working||this.destroyed)return;
        this.working=true;this.status('Retrying disk access…');
        try{await this.adapter.retry();if(this.destroyed)return;this.machine.run();this.status('');}
        catch(error){if(!this.destroyed)this.status('Windows paused: '+errorMessage(error),true);}
        finally{this.working=false;this.retry.disabled=false;}
    }
    async destroy() {
        if(this.destroyed)return;this.destroyed=true;this.abort?.abort();
        this.disk?.cancel();this.disk?.terminate();
        window.removeEventListener('resize',this.resize);window.removeEventListener('pagehide',this.leave);
        this.display.removeEventListener('pointerdown',this.gesture,true);this.retry.onclick=null;
        await this.disposeSession();
    }
}
export function start() {
    const session=new FutureSession();session.ready=session.load();return session;
}
