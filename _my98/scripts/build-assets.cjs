const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const esbuild = require('../../my98/node_modules/esbuild');

// Preserve my98's module/Worker URLs and the exact emulator bytes used by states.
const assets = JSON.parse(fs.readFileSync('my98/scripts/site-assets.json'));
const names = [
    'build/libv86.mjs', 'build/v86.wasm', 'bios/seabios.bin', 'bios/bochs-vgabios.bin',
    'build/disk/web/client.js', 'build/disk/web/worker.js',
    'build/disk/pkg/slop86_disk.js', 'build/disk/pkg/slop86_disk_bg.wasm',
    'src/browser/machine-state.js', 'src/browser/direct-pointer.js',
    'LICENSE', 'bios/COPYING.LESSER', 'slop86/LICENSE', 'slop86/LICENSE.MIT',
];
const lock = JSON.parse(fs.readFileSync('_my98/runtime/emulator/lock.json'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const revision = directory => execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
if(revision('my98') !== lock.my98 || revision('my98/vendor/slop86') !== lock.slop86 ||
    sha256(fs.readFileSync('my98/vendor/patches/slop86.patch')) !== lock.patchSha256)
    throw new Error('Update the published-state runtime lock for this my98 revision');
const runtime = 'build/my98-runtime';
fs.rmSync(runtime, {recursive:true, force:true});
for(const name of names) {
    const destination = path.join(runtime, name);
    fs.mkdirSync(path.dirname(destination), {recursive:true});
    // The published state authenticates exact bytes, including the C toolchain output.
    const source = name === 'build/v86.wasm' ? '_my98/runtime/emulator/v86.wasm' : path.join('my98', assets[name]);
    const bytes = fs.readFileSync(source);
    if(lock.assets[name] && sha256(bytes) !== lock.assets[name])
        throw new Error(`Incompatible published-state runtime: ${name}`);
    fs.writeFileSync(destination, bytes);
}
fs.mkdirSync('build/future', {recursive:true});
const config = JSON.parse(fs.readFileSync('_my98/runtime/config.json'));
if(Object.keys(config).sort().join(',') !== 'ipnsName,readKey' ||
    typeof config.ipnsName !== 'string' || !/^my98-ro-v2\.[A-Za-z0-9_-]{85}[AQgw]$/.test(config.readKey))
    throw new Error('Expected only the public IPNS name and read-only credential');
fs.writeFileSync('build/future/config.json', JSON.stringify(config) + '\n');
esbuild.buildSync({entryPoints:['_my98/runtime/app.js'], outfile:'build/future/app.js',
    bundle:true, format:'esm', target:'es2020', minify:true, legalComments:'linked',
    nodePaths:[path.resolve('my98/node_modules')]});
const hashes = Object.fromEntries(names.map(name => [name,
    createHash('sha256').update(fs.readFileSync(path.join(runtime, name))).digest('hex')]));
fs.writeFileSync('build/runtime-manifest.json', JSON.stringify(hashes, null, 2) + '\n');
console.log(`Packaged my98 runtime (${names.length} files) and index.html application`);
