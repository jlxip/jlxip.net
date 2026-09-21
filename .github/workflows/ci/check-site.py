#!/usr/bin/env python3
"""Validate the files that will be uploaded to Pages."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

site = Path("build/site").resolve()
for name in ("index.html", "future.html", "TFG.pdf", "build/my98.js", "build/my98.min.js"):
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
