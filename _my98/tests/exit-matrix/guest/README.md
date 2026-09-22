# Isolated Windows 98 harness

Run commands from the jlxip.net repository. Requirements: Node, Python 3,
macOS `hdiutil`/APFS clone support, and Playwright installed in the sibling my98
checkout. No Windows compilation takes place on the host.

The accepted local delivery is `~/Desktop/exit-matrix`. Its `bridge-boot.my98`
is a cleanly shut-down copy with VBMOUSE 0.67, the native bridge EXE and test
page installed. It retains the already bootstrapped native XCC/XRC toolchain.
The original `~/Desktop/jlxip98-small` master is unchanged. Credentials remain
in the local 0600 file; do not add them or the VM images to Git.

## Repeat the guest acceptance

```sh
python3 _my98/tests/exit-matrix/guest/prepare.py
node _my98/tests/exit-matrix/guest/accept.mjs
```

`prepare.py` copies the initial development disk/state only when absent, creates
an update ISO from source hashes, and installs links to the frozen runtime,
canonical direct-pointer module and bridge controller. It never changes either
master disk. `accept.mjs` starts separate Chromium and WebKit VMs at 512 MiB,
with desktop and 390-px touch viewports. Each browser uses an in-memory disk
overlay, which is discarded on close. It refreshes the test page from the generated ISO, starts the server, opens IE, enters
fullscreen, tests the link and exit, repeats exit, types `works`, verifies a new OPEN carrying that text, and opens Start.
Screenshots and JSON results are written into the delivery directory. The
external link uses example.com; guest network relay sockets are closed. Do not
install Playwright context-wide request routing in this harness: in WebKit it
prevented this file-backed guest from booting. Browser-only popup denial tests
remain deterministic in `../browser.test.mjs`.
`ENGINE=chromium|webkit` and `MOBILE=0|1` select one case.

Environment overrides: `GUEST_ROOT`, `MY98_SOURCE`, `XOS_SOURCE`, `JLXIP_SITE`,
`DEV_BASE`, and `VBADOS_ZIP`. Defaults use sibling projects and the two Desktop
directories. VBMOUSE archive SHA256 is checked before use; its upstream source is
https://depot.javispedro.com/vbox/vbados/vbados.zip . The harness uses the original
ANS-136 AUTOEXEC.BAT/SYSTEM.INI fixtures when installing the driver; do not run
DRIVER.BAT against a different or personal guest.

The prebuilt test disk is a local artifact, not a published presentation state.
The larger experimental saved state now restores in Chromium and WebKit with
my98's bounded state reader (8-MiB reads), also installed in the shared Desktop
app. The previous WebKit failure came from a whole-Blob read above 100 MiB.
The exact saved bytes restore identically; Windows98 resumes and IE responds
to F11. The saved experimental HTML is older than the final bridge fixture;
this restoration check does not replace the bridge acceptance sequence.
See `~/Desktop/exit-matrix/evidence/state-fix/README.md`.

## Rebuild natively without bootstrap

Start the interactive harness (one JSON object per input line):

```sh
node _my98/tests/exit-matrix/guest/run.mjs
```

Use `VISIBLE=1` before the command to display its browser window.
It prints its own localhost URL and operates only its own isolated browser.
The following restores the original prepared compiler base and mounts the
freshly generated source update ISO:

```json
{"type":"disk"}
{"type":"restore"}
{"type":"cd"}
{"type":"run","command":"D:\\SETUP.BAT"}
```

Wait for the native compiler to finish; take screenshots as needed:

```json
{"type":"shot","name":"native-build"}
{"type":"extract","guest":"ANS078/build85.status","name":"build85.status"}
{"type":"extract","guest":"ANS078/BUILD/JLXIP98.EXE","name":"rebuilt.exe"}
```

`build85.status` must contain PASS; `bridge0.status` through `bridge3.status`
must be zero. Their matching logs capture all three XRC crates and XCC link.
The retained make frontend embeds the old leaf export manifest. The ISO's tiny
native XRust launcher therefore uses commands generated from the current
`jlxip98.inc`, with the retained ABI objects and CRT capsule. This is a native
incremental build, with no VC6 reinstall and no XCC/XRust bootstrap.

For another UI trial, use the accepted prepared disk instead of the compiler
snapshot, mount the update ISO, run SETUP.BAT, then start the server and page:

```json
{"type":"open","name":"bridge-boot.my98"}
{"type":"cd"}
{"type":"run","command":"D:\\SETUP.BAT"}
```

Wait for desktop readiness before sending commands. After compilation:

```json
{"type":"run","command":"C:\\ANS078\\BUILD\\JLXIP98.EXE --bridge"}
{"type":"run","command":"http://127.0.0.1/matrix.htm"}
{"type":"eval","code":"vm.keyboard_send_scancodes([0x57,0xd7])"}
{"type":"eval","code":"attach()"}
{"type":"shot","name":"presentation"}
```

Only toggle F11 when the screenshot shows IE in normal maximized mode. The
accepted disk starts that way. `click` takes host CSS x/y coordinates;
`eval` runs in this owned fixture. `state` saves a local experiment after
removing the CD, useful with Chromium. `quit` closes the isolated VM.

The original base lacks VBMOUSE. To create a driver-enabled copy from that base,
run `D:\\DRIVER.BAT` once, shut Windows down normally, export the stopped raw
disk with `{"type":"exportRaw"}`, then package it using the ANS-136 native
my98 disk packer. The accepted delivery already contains this result; ordinary
iterations should start with `bridge-boot.my98` and need none of these steps.

The retained independent HTTP oracle runs via `D:\\HTTP85.BAT` while the server
is running. Extract `ANS078/http85.log` and `.status` (zero; 61 PASS checks).
It uses the existing sample files in C:\\WWW; the bridge page is an additional
file. COM1 and cursor API faults are injected in the XOS host gates, separately
from the real guest UI acceptance.
