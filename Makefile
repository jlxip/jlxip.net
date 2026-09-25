.DEFAULT_GOAL := all
.PHONY: all runtime site clean

all: runtime

runtime:
	$(MAKE) -C my98 emulator disk
	node _my98/scripts/build-assets.cjs

site: runtime
	rm -rf build/site
	mkdir -p build/site/build
	cp index.html build/site/
	cp -R static/. build/site/
	cp -R build/future build/my98-runtime build/site/build/
	touch build/site/.nojekyll
	python3 .github/workflows/ci/check-site.py

clean:
	rm -rf build/future build/my98-runtime build/site

.PHONY: hooks site-test-clean
hooks:
	git config --local core.hooksPath .githooks

site-test-clean:
	python3 _my98/scripts/clean-site-test.py

.PHONY: future-test
future-test: all
	node _my98/tests/presentation-input.mjs
	cd my98 && CARGO_TARGET_DIR="$(CURDIR)/my98/build/disk-target" cargo build --manifest-path src/disk/Cargo.toml --locked --release --example compat
	node _my98/tests/future.mjs
