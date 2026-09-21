# Clean Pages build

Run `make hooks` once per clone to enable the pre-commit hook.
Run `make site-test-clean` to build the current Git index and its pinned submodules
in an isolated Ubuntu 24.04 x86-64 container. Docker must be running.
GitHub Actions runs the same command and uploads the resulting site.

Only staged files and committed submodule revisions are tested. Unstaged changes,
untracked files and existing build outputs are excluded. Commit and publish
submodule changes, then stage the updated gitlink, to include those changes in CI.
Logs and the tested artifact are kept under `build/ci-runs/`.
The toolchain image may be cached; source compilation always starts from scratch.
