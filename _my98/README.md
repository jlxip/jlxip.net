# my98 integration tools

Guest content, scripts and isolated tests for the my98 integration live here. Run commands
from the repository root; generated files stay in the ignored `build/` directory.

- `guest/index.html`: editable page served inside Windows 98; CSS and JavaScript are inline.
- `scripts/`: asset build, clean CI entry point and COM1 bridge controller.
- `tests/exit-matrix/`: bridge checks and the interactive Windows 98 harness.

```sh
make
node _my98/tests/exit-matrix/bridge.test.mjs
MY98_SOURCE=../my98 node _my98/tests/exit-matrix/browser.test.mjs
VISIBLE=1 node _my98/tests/exit-matrix/guest/run.mjs
```

See [the guest guide](tests/exit-matrix/guest/README.md) for the prepared VM
and interactive commands. `my98/` remains the pinned emulator dependency.

## Published read-only session

`index.html` loads the latest authenticated IPNS publication using my98's resolver,
read-only disk API and state restorer. It requires HTTP(S): for a local preview run
`make site` then `python3 -m http.server 8687 --directory build/site` and open `/` (or `/index.html`). Disk writes live in the session's memory and disappear on reload.

`runtime/config.json` deliberately contains a **public read-only credential** and
the IPNS name. Export a replacement locally with my98's existing command, entering
the password only at its prompt:

```sh
cd my98
python3 scripts/read-only-key.py --gateway https://piensa.jlxip.net > ../build/read-only-credential.json
```

Copy the exported `ipnsName` and `readKey` into the public configuration. The
`my98-ro-v2` credential covers available past and future disks and states of that
identity; new disk saves do not require exporting it again. It contains the public
identity and metadata decryption key, never signing material. Legacy v1 credentials
must be exported again; the disk/state files need no conversion. A publication without a state, an unverifiable
publication or a state from another runtime produces an error and Retry; there is
no cold boot or older-publication fallback. Retry during a disk read resumes the
same VM and retains session writes. Reload starts a separate session.

The restored homepage appears before background prefetch finishes. If the
publication includes a matching v2 load profile, only those disk ranges are
prefetched. **Exit The Matrix** preserves the same session, cache and pending
profile without starting a full-disk download. Disk ranges outside the profile
are fetched only when the guest reads them, including after Exit. Missing or
invalid profiles leave the session on demand; an early click or a program outside
the profile can still wait for disk data. Diagnostics are available through `disk.readStats()` without adding a
loading bar. See [my98's load-profile guide](../my98/scripts/load-profiles.md)
for recording and publishing profiles. Publishing a profile changes neither the
disk nor its state, and requires clients that support `load-profiles.json`.

`runtime/emulator/v86.wasm` is the exact binary built from the pinned my98 submodule
and used to save the published state. `lock.json` records both source revisions,
the my98 patch hash and all four compatibility asset hashes. Clang versions on macOS
and Ubuntu produce different WASM bytes even with identical source and Rust, so the
packager deliberately uses this locked binary on both platforms. It checks the
rebuilt ESM and original BIOS hashes too; it never changes or bypasses the state's
compatibility check. Updating the emulator requires explicitly replacing the lock
and binary with the build used by a newly published state. All upstream licenses
are copied with the runtime. The disk Worker and its WASM are built from source.

On a fresh checkout, install my98’s pinned build tool once:

```sh
cargo install wasm-bindgen-cli --version 0.2.100 --locked --root my98/build/crypto-tools
```

```sh
make future-test                 # signed fixtures, real VM, both browsers/mobile
node _my98/tests/future-real.mjs  # current real publication; requires network
node _my98/tests/load-profile-real.mjs # record and compare a real first-link profile
make site-test-clean             # exact staged tree, clean Ubuntu Pages artifact
SITE_ROOT=build/ci-runs/run-XXX/site EVIDENCE=build/future-ubuntu node _my98/tests/future-real.mjs
```

The real-publication test opens disposable sessions only: it does not publish,
export or modify the remote disk/state. Screenshots and JSON evidence are written
to `build/future-real/`; fixture results go to `build/future-tests/`. External-link
transport is captured inside the test so it does not navigate third-party sites.
The load-profile benchmark uses a local test wrapper around the immutable real
disk/state, never updates production IPNS, and writes timings, the recorded
profile and screenshots to `build/load-profile-real/`. It measures host link
opening, not the audible click. `SITE_ROOT` and `EVIDENCE` also select an Ubuntu
artifact and a separate evidence directory for this benchmark.
Real VM tests expose `window.session` through `serveFuture(root, true)` on the
HTTP server and verify that the CPU instruction counter advances. Avoid Playwright
request routing even just to inject HTML: in WebKit it can prevent the emulator's
immediately revoked Blob scheduling Worker from loading. The saved framebuffer and
`is_running()` can then look correct while the CPU never advances. Keep request
mocking in synthetic fixtures; use a server-side proxy when a real VM needs controlled
network responses.

The bridge's popup/no-opener/fallback behavior has separate browser tests above.

## Record all homepage actions

```sh
make
node _my98/scripts/record-load-profile.mjs
```

This records a **single journey** from the published state: my98, ECDH, YouTube,
Bachelor's thesis, Crypto 101, GitHub, then Exit The Matrix. It uses the real guest
and the load-analysis API; it captures external OPEN actions without visiting
those sites. It does not merge independently recorded profiles or publish IPNS.

The script then checks each action as the **first click in a fresh session** in
Chromium and WebKit, after the generated profile completes. It requires zero disk
requests through that action, including the guest's completion and the desktop
repaint on Exit. Verification uses the site’s normal profile-only prefetch
behavior, including after Exit.

The verified publication input is `build/load-profile-all-links/load-profiles.json`.
`candidate.json`, `record.json`, `record-trace.json`, `verification.json` and a
screenshot retain the evidence. A failed run does not replace a previously
verified profile. Retry verification without recording again with `--verify-only`.
Use `--output DIRECTORY`, `--site DIRECTORY` or `--gateway URL` to override the
output, built site and gateway (default: Piensa).

Coordinates and expected URLs describe the current 800×600 guest homepage;
update the script when that layout changes. A different disk/state needs a new
recording. Publish the verified JSON with the updated seedbox's `publish-profile`
command when ready; no disk or state re-save is required.


## First-visit loading

The site prepares its runtime alongside configuration and IPNS resolution. Resolution starts all configured queries together, offers verified candidates immediately and closes after five seconds or when all queries finish. A newer CID replaces the provisional session even after interaction; renewing the same CID does not restart it. Retry opens a new window. The default resolver used by other my98 clients retains its existing behavior.

Published states use the existing authenticated format. IPFS bytes stream through record authentication, decryption and gzip into the final state/overlay buffers. Restoration is committed only after EOF, lengths, authentication, gzip and compatibility checks pass. The emulator/BIOS and the published state retain their existing bytes.

`session.timings` (when the session is exposed by the test server) records runtime, resolution and per-attempt load phases without keys or state contents. `node _my98/tests/load-performance.mjs` compares a baseline artifact (`BASELINE_ROOT`, default `build/ans143/baseline`) with the current site (`SITE_ROOT`), five alternating pairs per browser, fresh contexts and an explicit common gateway (`GATEWAY`). `CONTROLLED=1` supplies the same current signed IPNS record with controlled response delays; state/block transport remains real. `PAIRS`, `ENGINE` and `EVIDENCE` restrict a diagnostic run. Prepare the baseline from the pre-change build; never compare two copies of the optimized artifact.

Persistent caching remains a separate improvement.

The site opts into `openReadOnly({preloadState:true})`: verified state bytes arrive
while the base disk opens. The exporter traverses 4 MiB ranges, with a 2 MiB stream
queue and a 4 MiB block cache that reuses range-boundary leaves. Its ordered
lookahead is twice the network budget so completed blocks waiting for a slow
predecessor do not occupy all download slots. Authentication,
compatibility checks and restoration still finish before execution.

The network scheduler starts each provider at two slots and grows its allowance
from successful data transfers, within the existing global maximum of eight.
The first data sample establishes the latency baseline; completed healthy windows
double the allowance. Slow transfers reduce it down to the established two-slot
baseline (or the configured global limit if lower), and rescue temporarily favors
healthy alternatives. A stalled foreground block can move early to another
verified provider, cancelling its old request first. A trickling body can also
move when its declared remaining size and measured rate indicate that restarting
on a verified alternative is substantially faster. If the alternate fails, one
ordinary attempt at the original remains available. Background load
profiles keep lower priority. `disk.readStats()` includes per-provider windows and
rescue counts; `disk.readTrace()` includes `fetch-rescue` when tracing is enabled.

For the performance harness, `GATEWAY=auto` retains normal provider discovery and
scheduling on both artifacts. Use an explicit gateway for a separate controlled
comparison. Browser contexts are fresh; remote gateway caches are not reset.
