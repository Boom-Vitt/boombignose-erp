#!/usr/bin/env python3
"""Write the BoomBigNose icon sizes from the official brand files.

The mark is https://boombignose.org/images/boombignose-brandmark.png.
The social cover is https://boombignose.org/images/og-cover-v2.png.
Both files in this directory are those downloads. This script checks
their SHA-256, then writes the icon files the window, installers, and
download page use. It does not fetch anything and it does not print secrets.
"""

import hashlib
import shutil
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
BRAND = Path(__file__).resolve().parent
MARK = BRAND / "boombignose-brandmark.png"
COVER = BRAND / "og-cover-v2.png"
MARK_SHA = "19c5585f144d06611f1eb9ad074cfbac7d67cbf9a4afdea0e2a0a2a32b82d61a"
COVER_SHA = "c51fe35b0c30b68596fd4887fcaa1566f2ef6f54f219e09ecbb8aea31a5050ee"
ICO_SIZES = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(path, digest):
    actual = sha256(path)
    if actual != digest:
        sys.exit("%s sha256 %s, expected %s" % (path, actual, digest))


def save_png(image, path, size):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.resize(size, Image.Resampling.LANCZOS).save(path, format="PNG")


def main():
    require(MARK, MARK_SHA)
    require(COVER, COVER_SHA)
    mark = Image.open(MARK).convert("RGBA")
    if mark.size != (512, 512):
        sys.exit("brandmark is %s, expected 512x512" % (mark.size,))
    cover = Image.open(COVER)
    if cover.size != (1200, 630):
        sys.exit("cover is %s, expected 1200x630" % (cover.size,))

    icon = BRAND / "icon.png"
    shutil.copyfile(MARK, icon)
    save_png(mark, ROOT / "packaging/linux/boombignose.png", (512, 512))
    save_png(mark, ROOT / "site/assets/brandmark.png", (512, 512))
    save_png(mark, ROOT / "site/assets/apple-touch-icon.png", (180, 180))
    save_png(mark, ROOT / "app/icon.png", (512, 512))
    save_png(mark, ROOT / "boombignose/cmd/boombignose-desktop/icon.png", (256, 256))

    ico = ROOT / "packaging/windows/icon.ico"
    ico.parent.mkdir(parents=True, exist_ok=True)
    mark.save(ico, format="ICO", sizes=ICO_SIZES)
    shutil.copyfile(ico, ROOT / "app/favicon.ico")

    icns = ROOT / "packaging/macos/icon.icns"
    icns.parent.mkdir(parents=True, exist_ok=True)
    mark.save(icns, format="ICNS")

    og = ROOT / "site/assets/og.png"
    og.parent.mkdir(parents=True, exist_ok=True)
    cover.save(og, format="PNG")

    for path in (icon, ico, icns, og, ROOT / "app/icon.png", ROOT / "app/favicon.ico"):
        if path.stat().st_size < 500:
            sys.exit("icon too small: %s" % path)
    print("wrote brand icons from", MARK.name)


if __name__ == "__main__":
    main()
