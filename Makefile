.DEFAULT_GOAL := all
.PHONY: all runtime clean

all: runtime

runtime:
	$(MAKE) -C my98 emulator disk
	node _my98/scripts/build-assets.cjs

clean:
	rm -rf build/future build/my98-runtime

.PHONY: hooks site-test-clean
hooks:
	git config --local core.hooksPath .githooks

site-test-clean:
	python3 _my98/scripts/clean-site-test.py

.PHONY: future-test
future-test: all
	cd my98 && CARGO_TARGET_DIR="$(CURDIR)/my98/build/disk-target" cargo build --manifest-path src/disk/Cargo.toml --locked --release --example compat
	node _my98/tests/future.mjs
