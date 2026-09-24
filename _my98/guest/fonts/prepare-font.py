"""Adapt VileR's v2.2 Px437 font to legacy TrueType tables for Windows 98.
Requires fonttools; argument: original oldschool_pc_font_pack_v2.2_FULL.zip.
Derivative font licensed CC BY-SA 4.0, like the original.
"""
from io import BytesIO
from pathlib import Path
import sys
from zipfile import ZipFile
from fontTools.ttLib import TTFont
from fontTools.ttLib.scaleUpem import scale_upem
with ZipFile(sys.argv[1]) as z:
    font = TTFont(BytesIO(z.read('ttf - Px (pixel outline)/Px437_IBM_VGA_9x16.ttf')))
scale_upem(font, 2048)
font['OS/2'].version = 0
font['OS/2'].fsSelection &= 0x7f
for table in ['GDEF', 'FFTM']:
    if table in font:
        del font[table]
names = {1: 'JlxiP VGA DOS', 3: 'JlxiP:VGADOS:Win98:1', 4: 'JlxiP VGA DOS', 6: 'JlxiP-VGA-DOS'}
for record in font['name'].names:
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
font.save(Path(__file__).with_name('VGADOS.TTF'))
