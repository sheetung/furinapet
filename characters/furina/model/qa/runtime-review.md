# Skinned candidate runtime review — 2026-09-07

## Second refinement (latest)

Asset SHA-256: `40dcbf26c49207f0dd729775f78db3f19fde3e4102211a514b00505f774d4ed5`.
Khronos: zero errors and warnings. Additional contract checks pass: head blink
position deltas are zero; both eye surfaces and both lids have weight channels
in the merged blink clip. GLB has 13 mesh objects, 19 joints, four clips and
five morph names. Three.js creates 14 SkinnedMesh instances from 14 primitives
(head has two materials), reporting 26 draw calls on the reviewed page.

The browser full-blink screenshot confirms independent closed eyelids with
unchanged hair silhouette. Blender `refined/blender-wave.png` no longer shows
the previous detached sleeve fragments. This is sampled-pose evidence, not
full-range visual acceptance. Eye-patch seams and expression polish remain.

Clicked the new spring impulse button. Later UI status confirmed spring enabled
and all three offsets settled to zero. The preview uses updateSpring with
120 Hz maximum substeps, k=18, damping=2.4, mass=.35 and ±.08 rad bounds.
Transient motion/collision range has not been comprehensively reviewed.

The first milestone record below is historical and applies to its stated hash.

## First milestone

Asset SHA-256: `83418eedff80dd1f8090003bf90a1cafdb0d2a28e5f37b908ebd7fc81204291e`

Preview: `http://127.0.0.1:1420/skinned-art.html`, started with `npm run dev`.
Three.js GLTFLoader loaded 9 SkinnedMesh objects, a 19-joint skin, four
AnimationMixer clips and five morph target names. The page rendered the
character with 18 transparent-material draw calls. Its production entry remains
separate; the shipped sprite asset was not replaced.

Manually exercised the `wave` clip button, rest pose, and explicit `blink`
morph selection at full strength. The DOM status confirmed selected controls;
the browser screenshot confirmed the eyes close. Loading/morph plumbing works,
but this is NOT a visual acceptance pass: the fringe moves with the eye shape.
Blender wave render also exposes stray sleeve/coat pixels. Do not approve the
large wave range until those source layers are rebuilt.

The spring checkbox is a small sinusoidal articulation test only, not a physical
spring solver or a completed spring acceptance test. Full motion-range visual
QA remains pending. No production acceptance record has been created.

Khronos validator: 0 errors, 0 warnings; nine informational NPOT texture notices.
Tool/API source: https://github.com/KhronosGroup/glTF-Validator/blob/main/node/README.md
Regression: 304 tests / 23 files passed; TypeScript and production build passed.
