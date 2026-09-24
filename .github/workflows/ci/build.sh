#!/bin/sh
set -eu
# A fresh snapshot must never contain outputs or installed dependencies.
test ! -e build
test ! -e my98/build
test ! -e my98/node_modules
. /etc/os-release
test "$ID" = ubuntu
test "$VERSION_ID" = 24.04
test "$(uname -m)" = x86_64
node --version
rustc --version
make
node --input-type=module --check < build/future/app.js
mkdir -p build/site/build
cp -- *.html *.pdf build/site/
cp -R build/future build/my98-runtime build/site/build/
touch build/site/.nojekyll
python3 .github/workflows/ci/check-site.py
