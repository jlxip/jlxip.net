.DEFAULT_GOAL := all
.PHONY: all emulator clean

all: build/my98.min.js

emulator:
	$(MAKE) -C my98 emulator node_modules/.package-lock.json

build/my98.js: Makefile _my98/scripts/build-assets.cjs emulator
	node _my98/scripts/build-assets.cjs bundle

build/my98.min.js: build/my98.js _my98/scripts/build-assets.cjs
	node _my98/scripts/build-assets.cjs minify

clean:
	rm -f build/my98.min.js build/my98.min.js.tmp build/my98.js.tmp

.PHONY: hooks site-test-clean
hooks:
	git config --local core.hooksPath .githooks

site-test-clean:
	python3 _my98/scripts/clean-site-test.py
