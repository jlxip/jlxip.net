.DEFAULT_GOAL := all
.PHONY: all emulator clean

all: build/my98.min.js

emulator:
	$(MAKE) -C my98 emulator node_modules/.package-lock.json

build/my98.js: Makefile emulator
	@mkdir -p build
	node -e '\
		const fs = require("node:fs"); \
		const assets = Object.fromEntries(Object.entries({ \
			bios: "my98/bios/seabios.bin", \
			vgaBios: "my98/bios/bochs-vgabios.bin", \
			wasm: "my98/build/v86-fallback.wasm" \
		}).map(([key, file]) => [key, fs.readFileSync(file).toString("base64")])); \
		const source = fs.readFileSync("my98/build/libv86.js", "utf8") + ";globalThis.JLXIP_ASSETS=" + JSON.stringify(assets) + ";"; \
		fs.writeFileSync("$@.tmp", source + "\n"); \
		fs.renameSync("$@.tmp", "$@"); \
	'

build/my98.min.js: build/my98.js
	node -e '\
		const fs = require("node:fs"); \
		const {gzipSync} = require("node:zlib"); \
		const esbuild = require("./my98/node_modules/esbuild"); \
		const source = fs.readFileSync("$<", "utf8").trimEnd(); \
		const marker = ";globalThis.JLXIP_ASSETS="; \
		const split = source.lastIndexOf(marker); \
		if(split < 0) throw new Error("Missing embedded assets"); \
		const assets = JSON.parse(source.slice(split + marker.length, -1)); \
		for(const key of Object.keys(assets)) assets[key] = gzipSync(Buffer.from(assets[key], "base64"), {level: 9}).toString("base64"); \
		assets.compression = "gzip"; \
		const result = esbuild.transformSync(source.slice(0, split) + marker + JSON.stringify(assets) + ";", {minify: true, target: "es2020", legalComments: "inline"}); \
		fs.writeFileSync("$@.tmp", result.code); \
		fs.renameSync("$@.tmp", "$@"); \
	'

clean:
	rm -f build/my98.min.js build/my98.min.js.tmp build/my98.js.tmp
