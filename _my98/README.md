# my98 integration tools

Scripts and isolated tests for the my98 integration live here. Run commands
from the repository root; generated files stay in the ignored `build/` directory.

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
