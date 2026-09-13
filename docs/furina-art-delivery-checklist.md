# Furina Art Delivery Checklist — prototype audit, 2026-09-07

## Selected production path

Latest refinement (2026-09-07): `furina.skinned.glb` now has 13 meshes,
19 joints, independent eye/lid surfaces and one coordinated blink clip.
Repaired arm textures and trimmed coat geometry remove sleeve islands in the
reviewed wave frame; blink no longer deforms head/hair. Candidate validation
passes but full art acceptance remains open. See `qa/runtime-review.md` and
`qa/refined/` under the model directory. The older counts below describe the
unskinned prototype, not the current candidate.

Current files are an experimental cutout prototype. The original Blender, skinning and morph delivery requirements remain in force. File existence below does not constitute acceptance.

## Files

- [x] `characters/furina/source-art/furina-puppet-base.png`
- [x] `characters/furina/model/textures/*.png` (9 layered RGBA pieces)
- [x] `characters/furina/model/furina.mesh.glb`
- [x] `characters/furina/model/furina.skeleton.json`
- [x] `characters/furina/model/furina.animations.json`
- [x] `characters/furina/model/bone_tags.json`
- [x] `characters/furina/model/furina.puppet.json`
- [x] `characters/furina/model/validation.json`

## Skeleton

- [x] `root` and `motion_root` exist and have separate responsibilities.
- [x] 27 unique bones use `snake_case` and `_left` / `_right` naming.
- [x] Look, gesture, step, spring and rigid-accessory controls are tagged.
- [x] Every visible plane is rigidly attached to exactly one parent bone.

## Art layers

- [x] Head/face/hat group.
- [x] Torso and costume center.
- [x] Left and right arms with glove silhouettes.
- [x] Left and right legs with shoe silhouettes.
- [x] Back-hair spring layer.
- [x] Left and right coat-tail spring layers.
- [ ] Joint overlap and hidden surfaces pass motion testing across the required range.

## Rendering

- [x] All textures are RGBA, non-empty and padded away from texture edges.
- [x] GLB embeds all 9 textures and uses unlit transparent materials.
- [x] Renderer supports deterministic `zIndex` ordering and pivot-safe geometry offsets.
- [x] `/skeletal-art.html` loads the development-only interactive art preview without increasing the production bundle.
- [ ] Independent motion QA passes. Earlier screenshots establish only that the PNG-plane demo renders.

## Validation

- [ ] Production asset validation passes. Basic structure passes; production gates currently fail.
- [x] TypeScript validation passes.
- [x] 304 automated tests pass.
- [x] Vite production build passes.

## Required delivery still outstanding

- [x] Editable `furina.blend` (Blender 5.1.1; skinned candidate, not final art).
- [ ] Skinned GLB with usable weights and no unused controls.
- [ ] Separately deformable face, eyes, hair, clothing and accessories.
- [ ] Neutral, happy, surprised, annoyed and tired expressions; functional blink.
- [x] Baked idle, wave, recoil and blink tracks in `furina.skinned.glb`; visual acceptance still pending.
- [x] Candidate Khronos glTF validation and actual GLB loading test (`qa/khronos-validation.json`, `/skinned-art.html`).
- [ ] Pose, spring and morph runtime tests.
- [ ] Final visual acceptance of the exported asset.

The existing v2 spritesheet remains active. It does not satisfy the missing skeletal asset requirements. This prototype must not be described as a completed PR2 delivery.
