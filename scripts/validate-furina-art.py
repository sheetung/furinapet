"""Validate the Furina cutout textures, rig contract, and generated GLB."""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from pathlib import Path

from PIL import Image


PIECES = ["head", "body", "hair_back", "arm_left", "arm_right", "leg_left", "leg_right", "coat_left", "coat_right"]
REQUIRED_BONES = {"root", "motion_root", "body", "spine", "chest", "neck", "head", "face", "eye_left", "eye_right"}


def parse_glb(path: Path) -> dict:
    payload = path.read_bytes()
    if len(payload) < 20:
        raise ValueError("GLB is too short")
    magic, version, total = struct.unpack_from("<4sII", payload, 0)
    if magic != b"glTF" or version != 2 or total != len(payload):
        raise ValueError("invalid GLB header")
    json_length, json_type = struct.unpack_from("<I4s", payload, 12)
    if json_type != b"JSON":
        raise ValueError("first GLB chunk is not JSON")
    return json.loads(payload[20 : 20 + json_length].decode("utf-8").rstrip(" \x00"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--json-out", type=Path, required=True)
    args = parser.parse_args()

    errors: list[str] = []
    warnings: list[str] = []
    textures = args.model_dir / "textures"
    texture_report = {}
    for name in PIECES:
        path = textures / f"{name}.png"
        if not path.exists():
            errors.append(f"missing texture: {path.name}")
            continue
        with Image.open(path) as image:
            bbox = image.getchannel("A").getbbox() if image.mode == "RGBA" else None
            texture_report[name] = {"mode": image.mode, "size": list(image.size), "alphaBounds": list(bbox) if bbox else None}
            if image.mode != "RGBA":
                errors.append(f"{path.name} is not RGBA")
            if bbox is None:
                errors.append(f"{path.name} is empty")
            elif bbox[0] == 0 or bbox[1] == 0 or bbox[2] == image.width or bbox[3] == image.height:
                warnings.append(f"{path.name} has artwork touching its texture edge")

    skeleton_path = args.model_dir / "furina.skeleton.json"
    skeleton = json.loads(skeleton_path.read_text(encoding="utf-8"))
    bones = skeleton.get("bones", [])
    names = [bone.get("name") for bone in bones]
    if len(names) != len(set(names)):
        errors.append("skeleton contains duplicate bone names")
    missing = sorted(REQUIRED_BONES - set(names))
    if missing:
        errors.append(f"skeleton misses required bones: {', '.join(missing)}")
    known = set(names)
    for bone in bones:
        parent = bone.get("parent")
        if parent is not None and parent not in known:
            errors.append(f"bone {bone.get('name')} has unknown parent {parent}")

    glb_path = args.model_dir / "furina.mesh.glb"
    try:
        gltf = parse_glb(glb_path)
        glb_nodes = {node.get("name") for node in gltf.get("nodes", [])}
        missing_glb = sorted(REQUIRED_BONES - glb_nodes)
        if missing_glb:
            errors.append(f"GLB misses required bones: {', '.join(missing_glb)}")
        if len(gltf.get("meshes", [])) != len(PIECES):
            errors.append(f"GLB mesh count is {len(gltf.get('meshes', []))}, expected {len(PIECES)}")
        if len(gltf.get("images", [])) != len(PIECES):
            errors.append(f"GLB image count is {len(gltf.get('images', []))}, expected {len(PIECES)}")
    except Exception as exc:  # validation should report rather than hide the cause
        errors.append(f"GLB validation failed: {exc}")
        gltf = {}

    production_errors = []
    if not (args.model_dir / "furina.blend").exists():
        production_errors.append("Missing editable furina.blend source")
    if not gltf.get("skins"):
        production_errors.append("GLB has no skin: named transform nodes are not a skinned armature")
    if not any(p.get("targets") for m in gltf.get("meshes", []) for p in m.get("primitives", [])):
        production_errors.append("GLB has no expression morph targets")
    if not gltf.get("animations"):
        production_errors.append("GLB has no baked animation clips")
    acceptance_path = args.model_dir / "production-acceptance.json"
    acceptance = {}
    if acceptance_path.exists():
        try:
            acceptance = json.loads(acceptance_path.read_text(encoding="utf-8"))
        except (ValueError, OSError) as exc:
            production_errors.append(f"Invalid production acceptance record: {exc}")
    glb_hash = hashlib.sha256(glb_path.read_bytes()).hexdigest() if glb_path.exists() else None
    if not glb_hash or acceptance.get("glbSha256") != glb_hash:
        production_errors.append("Missing or stale acceptance evidence for the current GLB")
    for gate in ("khronosValidation", "glbLoad", "pose", "spring", "morph", "visual"):
        if acceptance.get("checks", {}).get(gate) != "pass":
            production_errors.append(f"Production acceptance not passed: {gate}")
    report = {
        "ok": not errors and not production_errors,
        "structuralOk": not errors,
        "productionReady": not errors and not production_errors,
        "productionErrors": production_errors,
        "glbSha256": glb_hash,
        "rigType": skeleton.get("rigType"),
        "boneCount": len(bones),
        "textureCount": len(texture_report),
        "meshCount": len(gltf.get("meshes", [])),
        "textures": texture_report,
        "warnings": warnings,
        "errors": errors,
    }
    args.json_out.parent.mkdir(parents=True, exist_ok=True)
    args.json_out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if errors or production_errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
