"""Deterministically separate the approved Furina base into rigid cutout pieces."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw


# Polygons use normalized coordinates so the extraction remains reproducible if
# the approved source is regenerated at another resolution. Intentional overlap
# at shoulders, hips and coat roots prevents gaps during small bone rotations.
REGIONS = {
    "head": [(0.13, 0.02), (0.87, 0.02), (0.88, 0.39), (0.80, 0.46), (0.64, 0.46), (0.55, 0.43), (0.45, 0.43), (0.35, 0.46), (0.20, 0.45), (0.12, 0.38)],
    "body": [(0.40, 0.39), (0.60, 0.39), (0.64, 0.48), (0.60, 0.68), (0.40, 0.68), (0.36, 0.48)],
    "hair_back": [(0.20, 0.27), (0.35, 0.29), (0.43, 0.47), (0.31, 0.49), (0.22, 0.43), (0.78, 0.27), (0.65, 0.29), (0.57, 0.47), (0.69, 0.49), (0.79, 0.43)],
    "arm_left": [(0.37, 0.42), (0.43, 0.45), (0.36, 0.58), (0.33, 0.63), (0.24, 0.66), (0.16, 0.67), (0.14, 0.63), (0.27, 0.57), (0.31, 0.49)],
    "arm_right": [(0.57, 0.45), (0.63, 0.42), (0.69, 0.49), (0.73, 0.57), (0.86, 0.63), (0.84, 0.67), (0.76, 0.66), (0.67, 0.63), (0.64, 0.58)],
    "coat_left": [(0.34, 0.54), (0.50, 0.56), (0.47, 0.84), (0.30, 0.84), (0.20, 0.80), (0.22, 0.70), (0.28, 0.63)],
    "coat_right": [(0.50, 0.56), (0.66, 0.54), (0.72, 0.63), (0.78, 0.70), (0.80, 0.80), (0.70, 0.84), (0.53, 0.84)],
    "leg_left": [(0.36, 0.65), (0.51, 0.65), (0.50, 0.96), (0.35, 0.96)],
    "leg_right": [(0.49, 0.65), (0.64, 0.65), (0.65, 0.96), (0.50, 0.96)],
}


def region_mask(name: str, size: tuple[int, int], points: list[tuple[float, float]]) -> Image.Image:
    width, height = size
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    polygon = [(round(x * width), round(y * height)) for x, y in points]
    # hair_back is two disjoint side-lock polygons encoded as two five-point groups.
    if name == "hair_back":
        draw.polygon(polygon[:5], fill=255)
        draw.polygon(polygon[5:], fill=255)
    else:
        draw.polygon(polygon, fill=255)
    return mask


def extract_piece(source: Image.Image, name: str, points: list[tuple[float, float]]) -> tuple[Image.Image, tuple[int, int, int, int]]:
    mask = region_mask(name, source.size, points)
    if name == "coat_left":
        leg = region_mask("leg_left", source.size, REGIONS["leg_left"])
        mask = Image.eval(Image.frombytes("L", source.size, bytes(max(0, a - b) for a, b in zip(mask.tobytes(), leg.tobytes()))), lambda value: value)
    elif name == "coat_right":
        leg = region_mask("leg_right", source.size, REGIONS["leg_right"])
        mask = Image.eval(Image.frombytes("L", source.size, bytes(max(0, a - b) for a, b in zip(mask.tobytes(), leg.tobytes()))), lambda value: value)
    alpha = Image.new("L", source.size, 0)
    source_alpha = source.getchannel("A")
    alpha_data = bytes(min(a, m) for a, m in zip(source_alpha.tobytes(), mask.tobytes()))
    alpha.frombytes(alpha_data)
    bbox = alpha.getbbox()
    if bbox is None:
        raise ValueError("region produced an empty piece")
    rgba = source.copy()
    rgba.putalpha(alpha)
    crop = rgba.crop(bbox)
    pad = max(12, round(max(crop.size) * 0.035))
    piece = Image.new("RGBA", (crop.width + pad * 2, crop.height + pad * 2), (0, 0, 0, 0))
    piece.alpha_composite(crop, (pad, pad))
    return piece, bbox


def build_preview(pieces: dict[str, Image.Image], output: Path) -> None:
    order = ["head", "body", "hair_back", "arm_left", "arm_right", "coat_left", "leg_left", "leg_right", "coat_right"]
    cell = 256
    preview = Image.new("RGBA", (cell * 3, cell * 3), (18, 23, 40, 255))
    draw = ImageDraw.Draw(preview)
    for index, name in enumerate(order):
        col, row = index % 3, index // 3
        piece = pieces[name]
        scale = min((cell - 32) / piece.width, (cell - 52) / piece.height)
        thumb = piece.resize((max(1, round(piece.width * scale)), max(1, round(piece.height * scale))), Image.Resampling.LANCZOS)
        x = col * cell + (cell - thumb.width) // 2
        y = row * cell + 30 + (cell - 40 - thumb.height) // 2
        preview.alpha_composite(thumb, (x, y))
        draw.rectangle((col * cell, row * cell, (col + 1) * cell - 1, (row + 1) * cell - 1), outline=(62, 84, 140, 255))
        draw.text((col * cell + 10, row * cell + 8), name, fill=(229, 236, 255, 255))
    output.parent.mkdir(parents=True, exist_ok=True)
    preview.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, action="append", required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--qa-preview", type=Path, required=True)
    args = parser.parse_args()

    with Image.open(args.source) as image:
        source = image.convert("RGBA")
    if source.getchannel("A").getextrema() == (255, 255):
        raise ValueError("approved source has no transparent pixels")

    pieces: dict[str, Image.Image] = {}
    bounds: dict[str, list[int]] = {}
    for name, points in REGIONS.items():
        piece, bbox = extract_piece(source, name, points)
        pieces[name] = piece
        bounds[name] = list(bbox)
        for output_dir in args.output_dir:
            output_dir.mkdir(parents=True, exist_ok=True)
            piece.save(output_dir / f"{name}.png", optimize=True)

    build_preview(pieces, args.qa_preview)
    manifest = {
        "version": 1,
        "source": str(args.source.resolve()),
        "method": "normalized-polygon-cutout-with-joint-overlap",
        "pieces": {
            name: {"file": f"{name}.png", "sourceBounds": bounds[name], "textureSize": list(pieces[name].size)}
            for name in REGIONS
        },
    }
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
