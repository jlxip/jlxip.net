#!/usr/bin/env python3
"""Validate the files that will be uploaded to Pages."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

site = Path("build/site").resolve()
for name in ("index.html", "future.html", "TFG.pdf", "build/future/app.js", "build/future/config.json", "build/my98-runtime/build/libv86.mjs", "build/my98-runtime/build/v86.wasm", "build/my98-runtime/build/disk/web/worker.js"):
    assert (site / name).stat().st_size > 0, f"Empty or missing: {name}"

class References(HTMLParser):
    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name not in ("src", "href") or not value:
                continue
            url = urlsplit(value)
            if url.scheme or url.netloc or not url.path:
                continue
            target = (site / unquote(url.path.lstrip("/")) if url.path.startswith("/")
                      else self.page.parent / unquote(url.path)).resolve()
            assert target.is_relative_to(site), f"Reference outside site: {value}"
            assert target.exists(), f"Missing reference in {self.page.name}: {value}"

for page in site.rglob("*.html"):
    parser = References()
    parser.page = page
    parser.feed(page.read_text())
assert not any(p.is_symlink() for p in site.rglob("*")), "Pages artifacts cannot contain symlinks"
print("Pages artifact: PASS")

# Runtime modules must be copied byte-for-byte, including the emulator hash input.
import hashlib, json
for name, expected in json.loads(Path("build/runtime-manifest.json").read_text()).items():
    actual = hashlib.sha256((site / "build/my98-runtime" / name).read_bytes()).hexdigest()
    assert actual == expected, f"Changed runtime asset: {name}"
print("State runtime manifest: PASS")
