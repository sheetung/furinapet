# Refinement asset provenance — 2026-09-07

Built-in imagegen was used, not the CLI/API fallback. Original cutouts are
preserved. Generated alpha is preserved without thresholding or raster cleanup.
All paths below are relative to `characters/furina/model/textures/`.

## arm_right-repaired.png

Edit target: `arm_right.png`.

Prompt: Use case: precise-object-edit. Image 1 is edit target: isolated right-on-screen arm texture for a 2.5D chibi Furina puppet. Repair this texture, keeping exactly the same composition, arm diagonal from upper left shoulder to lower right white glove, proportions, dark navy/cobalt cel-shaded fabric, gold scroll ornament, scalloped cuff, white glove pose and blue shoulder ornament. Remove the white hair fragment above the shoulder and the detached blue triangle to the lower left of the cuff. Complete the rounded shoulder cap and continuous sleeve silhouette so it can rotate without revealing cut-off gaps. Output ONLY the clean single connected sleeve and glove on genuine transparent RGBA background; no background color or checkerboard, no extra parts, no text. Keep placement and canvas aspect ratio matching the reference, with small transparent margin. Preserve sharp anime ink outlines, do not restyle.

## arm_left-repaired.png

Edit target: `arm_left.png`.

Prompt: Use case: precise-object-edit. Image 1 is edit target, a left-on-screen arm texture for chibi Furina puppet. Repair this single connected sleeve and white glove on genuinely transparent RGBA background. Keep same diagonal composition upper right shoulder to lower left glove, exact dark cobalt/navy cel shaded fabric, gold scroll cuff ornament, scalloped blue cuff, glove pose and proportions. Remove floating white hair ABOVE shoulder and detached small blue triangle to RIGHT of cuff. Complete a rounded opaque shoulder cap with simple navy cloth, no extra star pendant, no torso, no new accessories. Preserve sharp anime outlines. No black fill, checkerboard or background, no labels. Match reference placement and canvas aspect ratio with transparent margins. This will be animated, so no cut-off holes or detached fragments.

## face-underlay-study.png

Edit target: `head.png`.

Prompt: Use case: precise-object-edit. Image 1 is edit target, the head texture of a 2.5D Furina puppet. Make a face-underlay texture: REMOVE ONLY both blue eyes and their dark eyelashes, replacing those pixels with continuous pale peach facial skin matching the adjacent cheek and forehead. Keep the thin eyebrows, tiny nose and smile mouth. Extremely important: keep every hair strand, white/light blue fringe, blue gold hat, blue bow, head silhouette, face outline, all colors and proportions, exact composition and placement UNCHANGED. Do NOT change expression elsewhere. The intentionally eyeless base will have independent eye meshes overlaid in Blender; this is not a final portrait. Output single head on actual transparent RGBA background, no checkerboard, no backdrop, no labels. Preserve canvas aspect ratio and relative registration of the original.

QA limitation: this result is RGB with a painted checkerboard, NOT a transparent
head asset. Only its interior eye-recess skin regions are sampled by the Blender
mesh. The original RGBA head remains responsible for hair, hat and silhouette.
Do not use this image as a full-head replacement. The left arm retained its
existing shoulder ornament despite the removal wording; it is a style variant,
not a pixel-identical restoration.
