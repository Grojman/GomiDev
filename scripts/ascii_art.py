"""Image -> ASCII conversion used by the site generator.

Usage as a CLI:
    python scripts/ascii_art.py logo.png --cols 64
"""

from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

from PIL import Image, ImageEnhance, ImageOps

# Ordered from "empty" to "full". White text on black: brighter pixel -> denser glyph.
RAMP = " .:-=+*#%@"
# Finer ramp, better for photos (video thumbnails, covers).
RAMP_DETAILED = " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$"
# Monospace glyphs are roughly twice as tall as they are wide.
CHAR_ASPECT = 0.5


def image_to_ascii(
    image: Image.Image | bytes | str | Path,
    cols: int = 64,
    ramp: str = RAMP,
    contrast: float = 1.0,
    alpha_threshold: int = 40,
) -> str:
    """Convert an image to ASCII art `cols` characters wide.

    Transparent pixels become spaces so logos keep their silhouette.
    """
    if isinstance(image, (bytes, bytearray)):
        image = Image.open(io.BytesIO(image))
    elif isinstance(image, (str, Path)):
        image = Image.open(image)

    img = image.convert("RGBA")
    bbox = img.getchannel("A").point(lambda a: 255 if a > alpha_threshold else 0).getbbox()
    if bbox:
        img = img.crop(bbox)

    w, h = img.size
    rows = max(1, round(h / w * cols * CHAR_ASPECT))
    img = img.resize((cols, rows), Image.LANCZOS)

    alpha = img.getchannel("A")
    gray = ImageOps.autocontrast(img.convert("L"), cutoff=1)
    gray = ImageEnhance.Contrast(gray).enhance(contrast)

    last = len(ramp) - 1
    lines = []
    for y in range(rows):
        line = []
        for x in range(cols):
            if alpha.getpixel((x, y)) <= alpha_threshold:
                line.append(" ")
            else:
                # Keep opaque pixels visible even when they are pure black.
                idx = max(1, round(gray.getpixel((x, y)) / 255 * last))
                line.append(ramp[idx])
        lines.append("".join(line).rstrip())
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("image", nargs="?")
    parser.add_argument("--cols", type=int, default=64)
    args = parser.parse_args()

    if args.image:
        print(image_to_ascii(args.image, cols=args.cols))
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
