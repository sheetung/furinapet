"""Recover a clean alpha matte while preserving the approved Furina RGB art."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rgb-source", type=Path, required=True)
    parser.add_argument("--alpha-source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--low", type=int, default=238)
    parser.add_argument("--high", type=int, default=253)
    args = parser.parse_args()

    with Image.open(args.rgb_source) as rgb_image, Image.open(args.alpha_source) as alpha_image:
        rgb = rgb_image.convert("RGB")
        alpha_rgba = alpha_image.convert("RGBA")
        if rgb.size != alpha_rgba.size:
            raise ValueError(f"source size mismatch: RGB {rgb.size}, alpha {alpha_rgba.size}")

        low, high = args.low, args.high
        if not 0 <= low < high <= 255:
            raise ValueError("expected 0 <= low < high <= 255")
        lut = [0 if value <= low else 255 if value >= high else round((value - low) * 255 / (high - low)) for value in range(256)]
        matte = alpha_rgba.getchannel("A").point(lut)

        result = rgb.convert("RGBA")
        result.putalpha(matte)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        result.save(args.output, optimize=True)


if __name__ == "__main__":
    main()
