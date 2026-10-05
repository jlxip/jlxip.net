.DEFAULT_GOAL := all
.PHONY: all runtime site run clean
PORT ?= 8687

all: runtime

runtime:
	$(MAKE) -C my98/my98 disk
	node my98/scripts/build-assets.cjs

site: runtime
	rm -rf build/site
	mkdir -p build/site/build
	cp my98/index.html build/site/
	cp -R static/. build/site/
	cp static/TFG.pdf build/site/theses/TFG.pdf
	cp -R build/future build/my98-runtime build/site/build/
	touch build/site/.nojekyll
	python3 .github/workflows/ci/check-site.py

run: site
	python3 -m http.server $(PORT) --bind 127.0.0.1 --directory build/site

clean:
	rm -rf build/future build/my98-runtime build/site

.PHONY: hooks site-test-clean
hooks:
	git config --local core.hooksPath .githooks

site-test-clean:
	python3 my98/scripts/clean-site-test.py

.PHONY: input-test future-test
input-test:
	node --test my98/tests/presentation-input-unit.mjs

future-test: all input-test
	node my98/tests/presentation-input.mjs
	node my98/tests/zoom-exit.mjs
	cd my98/my98 && CARGO_TARGET_DIR="$(CURDIR)/my98/my98/build/disk-target" cargo build --manifest-path src/disk/Cargo.toml --locked --release --example compat
	node my98/tests/future.mjs
