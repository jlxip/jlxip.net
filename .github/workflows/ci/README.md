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

## Static content

Put files and directories to publish unchanged in `static/`. Its contents are copied
recursively to the site root, including dotfiles, with no extension filter:
`static/capileira.png` becomes `/capileira.png`. Crypto 101 and the thesis PDF live
there too. The validator checks every static file byte-for-byte.

`index.html` remains the application entry point in the repository root. The names
`index.html`, `build/` and `.nojekyll` are reserved at the root of `static/` for the
application and generated assets. Symlinks are not supported by Pages.

Run `make site` to assemble and validate `build/site/`, then preview with
`python3 -m http.server 8687 --directory build/site`. CI uses the same target.
