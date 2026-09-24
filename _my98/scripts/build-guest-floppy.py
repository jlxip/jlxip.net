#!/usr/bin/env python3
"""Package the IE homepage, VGA font and license in a 1.44 MiB FAT12 floppy."""
from pathlib import Path
import hashlib
import struct
import sys

root = Path(__file__).resolve().parents[2]
out = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'build/guest-dos/jlxip-index.img'
files = [
    ('index.html', b'INDEX~1 HTM', root / '_my98/guest/index.html'),
    ('VGADOS.TTF', b'VGADOS  TTF', root / '_my98/guest/fonts/VGADOS.TTF'),
    ('LICENSE.TXT', b'LICENSE TXT', root / '_my98/guest/fonts/LICENSE.TXT'),
    ('README.TXT', b'README  TXT', root / '_my98/guest/fonts/README.TXT'),
]
image = bytearray(1474560)
image[:11] = b'\xeb\x3c\x90MSDOS5.0'
struct.pack_into('<HBHBHHBHHHII', image, 11, 512, 1, 1, 2, 224, 2880, 0xf0, 9, 18, 2, 0, 0)
image[36:39] = bytes([0, 0, 0x29])
struct.pack_into('<I', image, 39, 0x20260923)
image[43:54] = b'JLXIPNET   '
image[54:62] = b'FAT12   '
image[62:64] = b'\xcd\x18'
image[510:512] = b'\x55\xaa'
fat = bytearray(4608)
fat[:3] = b'\xf0\xff\xff'

def entry(cluster, value):
    offset = cluster * 3 // 2
    if cluster & 1:
        fat[offset] = (fat[offset] & 15) | ((value & 15) << 4)
        fat[offset + 1] = value >> 4
    else:
        fat[offset] = value & 255
        fat[offset + 1] = (fat[offset + 1] & 240) | (value >> 8)

cluster, directory = 2, 19 * 512
for name, short, source in files:
    content = source.read_bytes()
    count = (len(content) + 511) // 512
    assert count and cluster + count <= 2849
    if name == 'index.html':
        checksum = 0
        for byte in short:
            checksum = (((checksum & 1) << 7) + (checksum >> 1) + byte) & 255
        lfn = bytearray(b'\xff' * 32)
        lfn[0], lfn[11], lfn[12], lfn[13] = 0x41, 15, 0, checksum
        lfn[26:28] = b'\0\0'
        chars = [ord(c) for c in name] + [0] + [65535] * 2
        for offset, char in zip([1, 3, 5, 7, 9, 14, 16, 18, 20, 22, 24, 28, 30], chars):
            struct.pack_into('<H', lfn, offset, char)
        image[directory:directory + 32] = lfn
        directory += 32
    record = bytearray(32)
    record[:11], record[11] = short, 32
    struct.pack_into('<HHHI', record, 22, 0, ((2026 - 1980) << 9) | (9 << 5) | 23, cluster, len(content))
    image[directory:directory + 32] = record
    directory += 32
    for c in range(cluster, cluster + count):
        entry(c, c + 1 if c < cluster + count - 1 else 0xfff)
    offset = (33 + cluster - 2) * 512
    image[offset:offset + len(content)] = content
    cluster += count
    print(name, len(content), hashlib.sha256(content).hexdigest())
image[512:512 + 4608] = fat
image[512 + 4608:512 + 9216] = fat
out.parent.mkdir(parents=True, exist_ok=True)
out.write_bytes(image)
print(out)
