"""Build a compact textured glTF binary from the approved Furina cutout pieces.

The model uses rigid plane attachments under named bones. This is the intended
lightweight 2.5D path: every visible plane is effectively weighted 100% to its
parent bone, while facial expressions remain texture/morph driven at runtime.
"""

from __future__ import annotations

import argparse
import json
import struct
from dataclasses import dataclass
from pathlib import Path

from PIL import Image


@dataclass(frozen=True)
class BoneSpec:
    name: str
    parent: str | None
    translation: tuple[float, float, float]


@dataclass(frozen=True)
class PieceSpec:
    bone: str
    file: str
    size: tuple[float, float]
    pivot: tuple[float, float]
    z: float


BONES = [
    BoneSpec("root", None, (0.0, 0.0, 0.0)),
    BoneSpec("motion_root", "root", (0.0, 0.0, 0.0)),
    BoneSpec("body", "motion_root", (0.0, 0.30, 0.0)),
    BoneSpec("spine", "body", (0.0, 0.18, 0.0)),
    BoneSpec("chest", "spine", (0.0, 0.18, 0.0)),
    BoneSpec("neck", "chest", (0.0, 0.18, 0.0)),
    BoneSpec("head", "neck", (0.0, 0.10, 0.0)),
    BoneSpec("face", "head", (0.0, 0.10, 0.02)),
    BoneSpec("eye_left", "face", (-0.16, 0.12, 0.01)),
    BoneSpec("eye_right", "face", (0.16, 0.12, 0.01)),
    BoneSpec("hair_back", "head", (0.0, 0.0, -0.04)),
    BoneSpec("hair_side_left", "head", (-0.28, -0.10, 0.0)),
    BoneSpec("hair_side_right", "head", (0.28, -0.10, 0.0)),
    BoneSpec("hair_curl", "head", (-0.22, 0.43, 0.01)),
    BoneSpec("hat", "head", (0.13, 0.42, 0.02)),
    BoneSpec("hat_bow", "hat", (0.18, -0.02, 0.01)),
    BoneSpec("arm_left", "chest", (-0.38, 0.08, 0.03)),
    BoneSpec("arm_hand_left", "arm_left", (0.0, -0.52, 0.0)),
    BoneSpec("arm_right", "chest", (0.38, 0.08, 0.03)),
    BoneSpec("arm_hand_right", "arm_right", (0.0, -0.52, 0.0)),
    BoneSpec("leg_left", "body", (-0.16, -0.12, -0.01)),
    BoneSpec("leg_right", "body", (0.16, -0.12, -0.01)),
    BoneSpec("coat_left", "body", (-0.28, 0.10, -0.03)),
    BoneSpec("coat_right", "body", (0.28, 0.10, -0.03)),
    BoneSpec("skirt", "body", (0.0, -0.16, -0.02)),
    BoneSpec("cloth_center", "skirt", (0.0, -0.22, -0.01)),
    BoneSpec("accessory_brooch", "chest", (0.0, 0.05, 0.04)),
]


PIECES = [
    PieceSpec("hair_back", "hair_back.png", (1.05, 0.96), (0.50, 0.24), -0.05),
    PieceSpec("coat_left", "coat_left.png", (0.48, 0.86), (0.50, 0.88), -0.04),
    PieceSpec("coat_right", "coat_right.png", (0.48, 0.86), (0.50, 0.88), -0.04),
    PieceSpec("leg_left", "leg_left.png", (0.34, 0.76), (0.50, 0.88), -0.01),
    PieceSpec("leg_right", "leg_right.png", (0.34, 0.76), (0.50, 0.88), -0.01),
    PieceSpec("body", "body.png", (0.82, 0.86), (0.50, 0.50), 0.0),
    PieceSpec("arm_left", "arm_left.png", (0.36, 0.76), (0.50, 0.88), 0.03),
    PieceSpec("arm_right", "arm_right.png", (0.36, 0.76), (0.50, 0.88), 0.03),
    PieceSpec("head", "head.png", (1.06, 0.98), (0.50, 0.22), 0.05),
]


class BinaryBuffer:
    def __init__(self) -> None:
        self.data = bytearray()

    def add(self, payload: bytes, alignment: int = 4) -> tuple[int, int]:
        while len(self.data) % alignment:
            self.data.append(0)
        offset = len(self.data)
        self.data.extend(payload)
        return offset, len(payload)


def pack_floats(values: list[float]) -> bytes:
    return struct.pack(f"<{len(values)}f", *values)


def build(texture_dir: Path) -> tuple[dict, bytes]:
    blob = BinaryBuffer()
    gltf: dict[str, object] = {
        "asset": {"version": "2.0", "generator": "furinapet cutout builder"},
        "extensionsUsed": ["KHR_materials_unlit"],
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [],
        "meshes": [],
        "materials": [],
        "textures": [],
        "images": [],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}],
        "accessors": [],
        "bufferViews": [],
    }

    nodes: list[dict] = gltf["nodes"]  # type: ignore[assignment]
    node_index: dict[str, int] = {}
    for bone in BONES:
        node_index[bone.name] = len(nodes)
        nodes.append({"name": bone.name, "translation": list(bone.translation)})
    for bone in BONES:
        if bone.parent is not None:
            nodes[node_index[bone.parent]].setdefault("children", []).append(node_index[bone.name])

    for piece in PIECES:
        image_path = texture_dir / piece.file
        with Image.open(image_path) as image:
            if image.mode != "RGBA":
                raise ValueError(f"{image_path} must be RGBA")
            if image.getchannel("A").getbbox() is None:
                raise ValueError(f"{image_path} has no visible pixels")
        image_bytes = image_path.read_bytes()
        image_offset, image_length = blob.add(image_bytes)
        image_view = len(gltf["bufferViews"])  # type: ignore[arg-type]
        gltf["bufferViews"].append({"buffer": 0, "byteOffset": image_offset, "byteLength": image_length})  # type: ignore[union-attr]
        image_index = len(gltf["images"])  # type: ignore[arg-type]
        gltf["images"].append({"name": piece.bone, "mimeType": "image/png", "bufferView": image_view})  # type: ignore[union-attr]
        texture_index = len(gltf["textures"])  # type: ignore[arg-type]
        gltf["textures"].append({"sampler": 0, "source": image_index})  # type: ignore[union-attr]
        material_index = len(gltf["materials"])  # type: ignore[arg-type]
        gltf["materials"].append(  # type: ignore[union-attr]
            {
                "name": f"Material_{piece.bone}",
                "pbrMetallicRoughness": {
                    "baseColorTexture": {"index": texture_index},
                    "metallicFactor": 0.0,
                    "roughnessFactor": 1.0,
                },
                "alphaMode": "BLEND",
                "doubleSided": True,
                "extensions": {"KHR_materials_unlit": {}},
            }
        )

        width, height = piece.size
        pivot_x, pivot_y = piece.pivot
        x0, x1 = -pivot_x * width, (1.0 - pivot_x) * width
        y0, y1 = -pivot_y * height, (1.0 - pivot_y) * height
        positions = [x0, y0, piece.z, x1, y0, piece.z, x1, y1, piece.z, x0, y1, piece.z]
        uvs = [0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0]
        indices = struct.pack("<6H", 0, 1, 2, 0, 2, 3)

        primitive_accessors: list[int] = []
        for payload, target, component_type, count, kind, min_value, max_value in [
            (pack_floats(positions), 34962, 5126, 4, "VEC3", [x0, y0, piece.z], [x1, y1, piece.z]),
            (pack_floats(uvs), 34962, 5126, 4, "VEC2", [0.0, 0.0], [1.0, 1.0]),
            (indices, 34963, 5123, 6, "SCALAR", [0], [3]),
        ]:
            offset, length = blob.add(payload)
            view_index = len(gltf["bufferViews"])  # type: ignore[arg-type]
            gltf["bufferViews"].append(  # type: ignore[union-attr]
                {"buffer": 0, "byteOffset": offset, "byteLength": length, "target": target}
            )
            accessor_index = len(gltf["accessors"])  # type: ignore[arg-type]
            gltf["accessors"].append(  # type: ignore[union-attr]
                {
                    "bufferView": view_index,
                    "componentType": component_type,
                    "count": count,
                    "type": kind,
                    "min": min_value,
                    "max": max_value,
                }
            )
            primitive_accessors.append(accessor_index)

        mesh_index = len(gltf["meshes"])  # type: ignore[arg-type]
        gltf["meshes"].append(  # type: ignore[union-attr]
            {
                "name": f"{piece.bone}_plane",
                "primitives": [
                    {
                        "attributes": {"POSITION": primitive_accessors[0], "TEXCOORD_0": primitive_accessors[1]},
                        "indices": primitive_accessors[2],
                        "material": material_index,
                    }
                ],
            }
        )
        nodes[node_index[piece.bone]]["mesh"] = mesh_index

    gltf["buffers"] = [{"byteLength": len(blob.data)}]
    return gltf, bytes(blob.data)


def write_glb(gltf: dict, binary: bytes, output: Path) -> None:
    json_bytes = json.dumps(gltf, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * ((4 - len(json_bytes) % 4) % 4)
    binary += b"\x00" * ((4 - len(binary) % 4) % 4)
    total_length = 12 + 8 + len(json_bytes) + 8 + len(binary)
    payload = bytearray(struct.pack("<4sII", b"glTF", 2, total_length))
    payload.extend(struct.pack("<I4s", len(json_bytes), b"JSON"))
    payload.extend(json_bytes)
    payload.extend(struct.pack("<I4s", len(binary), b"BIN\x00"))
    payload.extend(binary)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(payload)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--textures", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    gltf, binary = build(args.textures)
    write_glb(gltf, binary, args.output)


if __name__ == "__main__":
    main()
