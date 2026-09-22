# Exit the matrix — isolated prototype

`../../scripts/exit-matrix/bridge.js` consumes COM1 output from one v86 session.
The guest runs `jlxip98.exe --bridge` from the `jlxip98-small` branch and serves
this directory's `index.html` as `C:\WWW\matrix.htm`. Open that page in IE 5,
put IE in fullscreen with F11 **before** attaching the controller, and use the
existing `setupDirectPointer` module from my98 with VBMOUSE installed.

```js
const pointer = setupDirectPointer({display, getSurface: () => canvas,
    getMachine: () => machine, focus: () => canvas.focus()});
const bridge = attachMatrixBridge({machine, surface: canvas, pointer});
// On disposal: bridge.destroy(); pointer.destroy();
```

The bridge owns the canvas cursor and keyboard enablement while attached.
The caller owns the direct-pointer controller and VM lifetime. Attach once per
VM; a WeakMap retains the completed exit even if the controller is reattached.
Creating a fresh VM creates a new session. The initial guest presentation must
already be fullscreen; F11 toggles the focused guest window, so keep IE focused
until exit. This prototype does not configure autostart or publish a state.

Frames are printable ASCII with an LF terminator: `JLX98/1 EXIT` or
`JLX98/1 OPEN <encoded URL>`. The URL is percent-encoded ASCII, at most 1536
bytes, HTTP(S), without credentials or control characters. Unknown, malformed,
overlong and unfinished frames are ignored. An unfinished frame expires after
two seconds and its tail is discarded through the next newline.

Exit releases mouse buttons, sends F11 once, enables keyboard input and hides
the host cursor only on the canvas. The guest restores its cursor images before
sending EXIT. External links open a blank tab, clear its opener, then navigate;
a denied popup navigates the current tab. The page reports that a link was sent,
not that the host navigation completed. An asynchronous serial message need not
retain browser user activation, so popup blocking is an expected case.

The guest test page uses a fixed iframe, `document.all` fallback and a small
ASCII encoder, avoiding APIs missing from IE 5. Completion is deferred outside
iframe document loading, using string timers and global state instead of timer
closures; status updates use `innerText`. Repeated exit clicks and stylesheet
changes are ignored after success. The earlier page crashed IE 5 during the
full link/wait/exit/text sequence. The guest acceptance now requires a second
OPEN message carrying the text typed after exit, as well as visual inspection
of IE and the desktop; a serial EXIT alone is insufficient proof.

## Tests

From the jlxip.net root:

```sh
node _my98/tests/exit-matrix/bridge.test.mjs
MY98_SOURCE=../my98 node _my98/tests/exit-matrix/browser.test.mjs
```

The browser fixture imports the canonical existing direct-pointer module from
`MY98_SOURCE` (default `../my98`). It does not modify or update the site's my98
submodule. Browser results and screenshots go to `build/exit-matrix`.

Native build and guest acceptance use the [isolated guest harness](guest/README.md),
with the local delivery in `~/Desktop/exit-matrix`. Host tests alone do not assert Windows cursor/fullscreen behavior.
The final content, `future.html`, autostart and public snapshot integration are
outside this prototype.
