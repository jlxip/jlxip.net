IBM VGA 9x16 / CP437 font, adapted from The Ultimate Oldschool PC Font Pack v2.2.
Original outline conversion by VileR: https://int10h.org/oldschool-pc-fonts/
Original and derivative font license: CC BY-SA 4.0 (see LICENSE.TXT).

VGADOS.TTF is named JlxiP VGA DOS to distinguish this Windows 98 adaptation.
Glyph shapes and character mapping are preserved. Units-per-em are scaled
from 1600 to 2048 (a power of two required by older TrueType rasterizers). The OS/2 table is reduced to v0,
modern fsSelection bits are cleared, and GDEF/FFTM tables are removed.
The source conversion script is prepare-font.py in the repository; it needs
fonttools and the original oldschool_pc_font_pack_v2.2_FULL.zip archive.

Install in Windows 98: Control Panel > Fonts > File > Install New Font.
Choose drive A:, select JlxiP VGA DOS, and enable copying to Fonts.
Then copy A:\index.html to C:\WWW\index.html and reopen the page in IE.
Save the disk and a new state after installing the font and opening the page.

The HTML remains UTF-8; the font provides the CP437 glyph shapes.
Text is 16 pixels, heading 32 pixels, link line spacing 32 pixels.
