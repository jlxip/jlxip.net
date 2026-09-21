.DEFAULT_GOAL := all
.PHONY: all emulator clean

all: build/my98.min.js

emulator:
	$(MAKE) -C my98 emulator node_modules/.package-lock.json

build/my98.js: Makefile scripts/build-assets.cjs emulator
	node scripts/build-assets.cjs bundle

build/my98.min.js: build/my98.js scripts/build-assets.cjs
	node scripts/build-assets.cjs minify

clean:
	rm -f build/my98.min.js build/my98.min.js.tmp build/my98.js.tmp

.PHONY: hooks site-test-clean
hooks:
	git config --local core.hooksPath .githooks

site-test-clean:
	python3 scripts/clean-site-test.py
