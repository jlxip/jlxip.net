# my98 integration tools

Guest content, scripts and isolated tests for the my98 integration live here. Run commands
from the repository root; generated files stay in the ignored `build/` directory.

- `index.html`: public application entry point.
- `../static/`: unchanged files copied to the public site root.
- `guest/index.html`: editable page served inside Windows 98; CSS and JavaScript are inline.
- `scripts/`: asset build, clean CI entry point and COM1 bridge controller.
- `tests/exit-matrix/`: bridge checks and the interactive Windows 98 harness.
- `my98/`: pinned emulator submodule.

```sh
make
node my98/tests/exit-matrix/bridge.test.mjs
MY98_SOURCE=../my98 node my98/tests/exit-matrix/browser.test.mjs
VISIBLE=1 node my98/tests/exit-matrix/guest/run.mjs
```

See [the guest guide](tests/exit-matrix/guest/README.md) for the prepared VM
and interactive commands.

## Published read-only session

`index.html` resolves the latest signed BEP46 publication through my98's WebTorrent
read-only API, restores its authenticated state, then starts the existing presentation.
For a local preview run `make run` and open `http://127.0.0.1:8687/`.
The built HTML selects a content-hashed app URL. All runtime imports, including
client, Worker, bindings and WASM, share a content-addressed directory so a
cached V1 client cannot be paired with a V2 Worker on a fresh load.
Disk writes stay in RAM and disappear on reload. The configuration contains the
existing public `my98-ro-v2` read key and optional `sources` (APIs, webseeds,
trackers); its embedded public key identifies the publication. No password or
signing key is included. IPNS names and CID arguments are no longer used.

A publication without a state, an unverifiable publication or an incompatible
runtime produces an error and Retry. There is no cold-boot fallback. Retry after
a disk-read failure resumes the same VM and retains its writes. Reload opens the
latest accepted signed publication in a new session.

The site opens with `prefetchScope:"none"`, restores and displays the saved state,
then loads only its matching optional profile after the first visible frame.
Profile lookup and validation never delay presentation. Cancellation stops the
scheduled lookup, and late failures from an old attempt cannot affect a new one. Exit The Matrix preserves that selection and the
same session; unused ranges load on demand. An absent, invalid or unavailable
optional profile leaves the restored machine on demand. WebTorrent caches verified
ciphertext pieces in IndexedDB; profile ranges may include the surrounding 256 KiB
torrent pieces. This is distinct from downloading the whole disk in the background.

`runtime/emulator/libv86.mjs` and `runtime/emulator/v86.wasm` are the exact emulator
bytes required by the published state. `lock.json` records the current source
revisions, the source revisions of those state-compatible bytes and all four
compatibility asset hashes. Clang versions on macOS and Ubuntu
can produce different WASM bytes, so the packager uses these locked files on both
platforms. It checks their hashes and the original BIOS hashes without bypassing
the state's compatibility check. Updating the emulator requires a newly published
state and matching locked files. All upstream licenses are copied with the runtime.
The disk Worker and its WASM are built from the current submodule source. After
committing source changes in my98, point the site gitlink and `lock.my98` at that
same commit; keep the state runtime revisions and compatibility hashes unchanged.

On a fresh checkout, install my98’s pinned build tool once:

```sh
cargo install wasm-bindgen-cli --version 0.2.100 --locked --root my98/my98/build/crypto-tools
```

```sh
make input-test                  # site input + direct pointer; Node, no browser/UI
make future-test                 # signed fixtures, real VM, both browsers/mobile
node my98/tests/future-real.mjs  # current real publication; requires network
node my98/scripts/record-load-profile.mjs # record and verify all homepage actions
make site-test-clean             # exact staged tree, clean Ubuntu Pages artifact
SITE_ROOT=build/ci-runs/run-XXX/site EVIDENCE=build/future-ubuntu node my98/tests/future-real.mjs
```

After Exit The Matrix, a stationary one-finger hold for 500 ms produces one
right click immediately; releasing it produces no further click. Short taps
remain left clicks. Movement beyond 8 CSS pixels or a second finger cancels the
gesture; native pinch zoom remains available. Two short taps within 500 ms and
8 CSS pixels use the first tap's position, making double taps tolerant of finger
jitter on a scaled desktop. Both clicks are sent immediately on release; Windows
retains its own double-click timing rules. A long/cancelled gesture, session or
frame change clears the remembered tap. Mouse input and touch before Exit are unchanged.
The Node input tests use controlled time and the real direct-pointer module with
an in-memory event/capture harness. Physical Safari/iPhone and Chrome/Android
checks are still needed to verify native pinch zoom, callout suppression and the
guest context menu. These tests do not substitute for those manual checks.

The real-publication test opens disposable sessions only: it does not publish,
export or modify the remote disk/state. Screenshots and JSON evidence are written
to `build/future-real/`; fixture results go to `build/future-tests/`. External-link
transport is captured inside the test so it does not navigate third-party sites.
The real test uses signed BEP46 by default. Before republication, set
`MIGRATION_DIR=build/webtorrent-migration EVIDENCE=build/webtorrent-migration/real`
to serve recovered ciphertext and a local immutable descriptor. This checks the
real state and presentation without claiming a signed publication exists yet.

The real-publication test observes `FutureSession.load` and `fit` through an
init-script import of the page's original app module. A resize captures an already
started session without reloading it. The test verifies that the CPU instruction
counter advances. It serves the original HTML without rewriting or intercepting requests.
To check the deployed site with the same assertions:

```sh
PUBLIC_URL=https://jlxip.net/ EVIDENCE=build/future-public node my98/tests/future-real.mjs
```

`PUBLIC_URL` and `MIGRATION_DIR` are mutually exclusive. The app import uses an
absolute URL because WebKit cannot resolve a relative import in this init script.
Avoid Playwright request routing even just to inject HTML: in WebKit it can prevent
the emulator's immediately revoked Blob scheduling Worker from loading. The saved
framebuffer and `is_running()` can then look correct while the CPU never advances.
Keep request mocking in synthetic fixtures; use a server-side proxy when a real VM
needs controlled network responses. Session teardown is bounded so a failed
scheduling Worker cannot hang cleanup.

The bridge's popup/no-opener/fallback behavior has separate browser tests above.

## Record all homepage actions

```sh
make
node my98/scripts/record-load-profile.mjs
```

This records a **single journey** from the published state: my98, ECDH, YouTube,
Bachelor's thesis, Crypto 101, GitHub, then Exit The Matrix. It uses the real guest
and the load-analysis API; it captures external OPEN actions without visiting
those sites. It does not merge independently recorded profiles or publish.

The script then checks each action as the **first click in a fresh session** in
Chromium and WebKit, after the generated profile completes. It requires zero disk
requests through that action, including the guest's completion and the desktop
repaint on Exit. Verification uses the site’s normal profile-only prefetch
behavior, including after Exit.

The verified publication input is `build/load-profile-all-links/load-profiles.json`.
`candidate.json`, `record.json`, `record-trace.json`, `verification.json` and a
screenshot retain the evidence. A failed run does not replace a previously
verified profile. Retry verification without recording again with `--verify-only`.
Use `--output DIRECTORY`, `--site DIRECTORY` or `--source API_URL` to override the
output, built site and torrent source API (default: the configured my98 nodes).

Coordinates and expected URLs describe the current 800×600 guest homepage;
update the script when that layout changes. A different disk/state needs a new
recording. Publish the verified JSON with the my98 CLI's `profile` command when ready; no disk or state re-save is required.


## Publication preparation

To move the existing machine, recover the encrypted disk, state and profile from
the signed IPFS directory and verify every content-addressed block. Disk and state
bytes stay identical. Convert only the profile's `cid` field to the deterministic
new disk `infoHash`; preserve its ranges and state SHA-256. The Mac publisher CLI
accepts `publish disk.my98 --state state.my98state --profile load-profiles.json`
and prompts for username/password. It verifies the disk identity, copies the
components to a followed seedbox, then publishes the signed BEP46 name.

Commit shared my98 source changes first, then update this site's gitlink and
`lock.my98` to that commit. The state-compatible emulator/BIOS hashes stay fixed.
`make site-test-clean` tests only staged files and committed submodule revisions;
it cannot include uncommitted shared-source changes.

`future.mjs` exercises signed disposable publications in Chromium/WebKit, including
state, profile-only prefetch, Exit, demand reads, read-only restrictions, retries
and missing/corrupt publications. `future-real.mjs` checks the actual Windows guest,
links, framing, touch, keyboard and demand reads. `load-performance.mjs` compares
restore/first-link timings between two WebTorrent site artifacts using the same
signed publication; it does not claim an improvement automatically.
