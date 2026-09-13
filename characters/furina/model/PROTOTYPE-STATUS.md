# Prototype status — 2026-09-07

> Superseded status, 2026-09-13: experiment paused; visual art rejected for final delivery.
> Current candidate: 21 joints, 13 meshes, 6,350 Blender vertices, 8 clips.
> Older 19-joint / 4-clip figures below describe historical versions.
> See [current snapshot](../../../docs/art-pipeline-snapshot.md).

This directory is not a completed production character package.

## Latest refinement — 2026-09-07

The candidate now has 13 meshes / 19 joints / 6,350 vertices. Both arms use
new generated RGBA repairs; coat mesh coverage excludes sleeve contamination.
Independent eye patches and modelled eyelid strokes eliminate head/hair blink
deformation. Five morph names are coordinated across five mesh objects; the
four exported clips include one merged blink action. The browser creates 14
SkinnedMesh objects because the head has two material primitives.

Latest renders: `qa/refined/`. Provenance: `../source-art/refinement-prompts.md`.
The generated face underlay has an opaque checkerboard outside the head; only
its internal skin regions are sampled. It is NOT a transparent replacement head.
Current wave render no longer shows the previous floating sleeve islands.
Edge matching, expression polish, independent brows/mouth, complete pose/spring
review, sidecar synchronization and production integration remain outstanding.
The preview now uses a damped spring impulse test rather than sine offsets.
Below is the first milestone's historical snapshot, not the latest asset count.

## Blender milestone (2026-09-07)

`furina.blend` now contains an editable 2.5D model, 19-bone armature,
9 weighted meshes (4,548 vertices), and five facial shape studies.
`furina.skinned.glb` is the new candidate, with one skin and actual `idle`,
`wave`, `recoil`, `blink` animation tracks. Neutral is the base shape;
`happy`, `surprised`, `annoyed`, `tired`, `blink` are the morph names.
This candidate is deliberately separate from the old `furina.mesh.glb` below.
The existing skeleton/animation JSON sidecars describe the older prototype,
not this candidate. Read the embedded skin and clips for the candidate.

Khronos validation and its asset hash are in `qa/khronos-validation.json`.
The dedicated `/skinned-art.html` page uses Three.js GLTFLoader and an
AnimationMixer on the actual GLB, unlike the older PNG-plane demo.
Render studies are under `qa/skinned/`. Build with:

```powershell
& 'D:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background --factory-startup --python scripts\build-furina-blender.py
npm install --prefix tmp/gltf-validation --ignore-scripts gltf-validator@2.0.0-dev.3.10
node scripts/validate-furina-skinned.mjs
npm run dev -- --host 127.0.0.1
```

### Visual rejection reasons (not fixed by structural validation)

- Wave exposes disconnected clothing/hair remnants in the arm texture and
  insufficient hidden shoulder artwork.
- Blink closes the eyes but deforms the fringe and eye corners because they
  are still painted on a shared head atlas. Separate eye/lid/face layers are needed.
- Happy/surprised/annoyed/tired are UV-warp studies, not accepted expression art.
- Eye/face controls do not yet have independent artwork or useful eye-aim weights.
- Large-angle turns, production pose limits and spring acceptance are outstanding.

Do not replace the shipped sprite pet or mark PR2 complete with this candidate.

## Earlier unskinned prototype

The current GLB has nine textured planes under 27 named transform nodes. It has no glTF skins, vertex joint weights, morph targets or animation tracks. Several named controls have no independently movable artwork. `furina.animations.json` describes intended behavior; it is not baked animation data.

The development page `skeletal-art.html` renders PNG planes through a separate hand-authored 2D skeleton. Its successful rendering and the repository's 304 passing tests do not establish GLB loading, glTF compliance, morph support or production art acceptance.

The retained base, cutouts and preview are useful design/prototype inputs. Hidden areas still need complete artwork before large rotations can be approved. The existing shipped spritesheet is unchanged.

Required next work follows `docs/furina-rig-standard.md` and `docs/furina-art-production-plan.md`: editable Blender source, separated facial and accessory artwork, armature/weights, expression shapes, animation clips, actual GLB loading and independent motion/visual review.

`validation.json` distinguishes `structuralOk` from `productionReady`. Production success requires the missing GLB data and a `production-acceptance.json` record tied to the current GLB SHA-256. Its `checks` must contain measured/reviewed passes for `khronosValidation`, `glbLoad`, `pose`, `spring`, `morph` and `visual`; file existence alone is not sufficient.
