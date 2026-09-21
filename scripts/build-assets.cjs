const fs = require("node:fs");
const { gzipSync } = require("node:zlib");

function write(output, source) {
    fs.mkdirSync("build", { recursive: true });
    fs.writeFileSync(output + ".tmp", source);
    fs.renameSync(output + ".tmp", output);
}

if (process.argv[2] === "bundle") {
    const assets = Object.fromEntries(Object.entries({
        bios: "my98/bios/seabios.bin",
        vgaBios: "my98/bios/bochs-vgabios.bin",
        wasm: "my98/build/v86-fallback.wasm",
    }).map(([key, file]) => [key, fs.readFileSync(file).toString("base64")]));
    const source = fs.readFileSync("my98/build/libv86.js", "utf8")
        + ";globalThis.JLXIP_ASSETS=" + JSON.stringify(assets) + ";\n";
    write("build/my98.js", source);
} else if (process.argv[2] === "minify") {
    const esbuild = require("../my98/node_modules/esbuild");
    const source = fs.readFileSync("build/my98.js", "utf8").trimEnd();
    const marker = ";globalThis.JLXIP_ASSETS=";
    const split = source.lastIndexOf(marker);
    if (split < 0) throw new Error("Missing embedded assets");
    const assets = JSON.parse(source.slice(split + marker.length, -1));
    for (const key of Object.keys(assets)) {
        assets[key] = gzipSync(Buffer.from(assets[key], "base64"), { level: 9 }).toString("base64");
    }
    assets.compression = "gzip";
    const result = esbuild.transformSync(source.slice(0, split) + marker + JSON.stringify(assets) + ";", {
        minify: true, target: "es2020", legalComments: "inline",
    });
    write("build/my98.min.js", result.code);
} else {
    throw new Error("Usage: node scripts/build-assets.cjs bundle|minify");
}
