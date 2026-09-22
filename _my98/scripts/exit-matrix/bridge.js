// One controller per VM session; keep the one-way transition across reattachment.
const sessions = new WeakMap();
const MAX_LINE = 1549;
export function decodeDestination(encoded) {
    if(!encoded || encoded.length > 1536 || !/^(?:[A-Za-z0-9_.!~*'()-]|%[0-9a-fA-F]{2})+$/.test(encoded)) return null;
    let text, url;
    try { text = decodeURIComponent(encoded); url = new URL(text); } catch { return null; }
    if(!/^https?:\/\//.test(text) || /[^\x21-\x7e]|\\/.test(text) ||
       !['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
}
export function openDestination(url, browser = window) {
    // Passing noopener to open() can return null even when opening succeeded.
    let tab;
    try { tab = browser.open('about:blank', '_blank'); } catch { tab = null; }
    if(!tab) { browser.location.assign(url); return 'current'; }
    try { tab.opener = null; tab.location.replace(url); return 'new'; }
    catch(error) {
        try { tab.close(); } catch { /* The browser may already have closed it. */ }
        browser.location.assign(url);
        return 'current';
    }
}
export function attachMatrixBridge({ machine, surface, pointer, browser = window, onExit = () => {}, onError = console.error }) {
    let session = sessions.get(machine);
    if(session?.controller) return session.controller;
    if(!session) { session = { exited: false, exiting: false }; sessions.set(machine, session); }
    let line = '', discard = false, timer = null, destroyed = false;
    const oldCursor = surface.style.getPropertyValue('cursor');
    const oldPriority = surface.style.getPropertyPriority('cursor');
    const oldKeyboard = machine.keyboard_adapter?.emu_enabled ?? true;
    pointer.activate();
    machine.keyboard_set_enabled(session.exited);
    surface.style.setProperty('cursor', session.exited ? 'none' : 'default', 'important');
    function reset() { line = ''; discard = false; clearTimeout(timer); timer = null; }
    async function command(value) {
        if(value === 'JLX98/1 EXIT') {
            if(session.exited || session.exiting) return;
            if(!machine.is_running()) return;
            session.exiting = true;
            try {
                pointer.release();
                await machine.keyboard_send_scancodes([0x57, 0xd7]);
                session.exited = true;
                if(destroyed) return;
                machine.keyboard_set_enabled(true);
                surface.style.setProperty('cursor', 'none', 'important');
                onExit();
            } finally { session.exiting = false; }
        } else if(value.startsWith('JLX98/1 OPEN ')) {
            const url = decodeDestination(value.slice(13));
            if(url) openDestination(url, browser);
        }
    }
    function receive(byte) {
        if(destroyed) return;
        if(byte === 10) {
            const value = line, valid = !discard;
            reset();
            if(valid) command(value).catch(onError);
            return;
        }
        // Expire incomplete frames. A later tail is discarded until its newline.
        if(!timer) timer = setTimeout(() => { line = ''; discard = true; timer = null; }, 2000);
        if(!Number.isInteger(byte) || byte < 32 || byte > 126 || line.length >= MAX_LINE) { discard = true; line = ''; }
        if(!discard) line += String.fromCharCode(byte);
    }
    const controller = {
        get exited() { return session.exited; },
        destroy() {
            if(destroyed) return;
            destroyed = true; reset();
            machine.remove_listener('serial0-output-byte', receive);
            surface.style.setProperty('cursor', oldCursor, oldPriority);
            machine.keyboard_set_enabled(oldKeyboard);
            pointer.release();
            session.controller = null;
        },
    };
    session.controller = controller;
    machine.add_listener('serial0-output-byte', receive);
    return controller;
}
