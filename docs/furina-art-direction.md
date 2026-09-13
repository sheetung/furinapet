# Furina Art Direction v1.0

## Visual target

The skeletal version keeps the identity already established by the shipped v2 spritesheet while moving to a clean 2.5D cutout construction. At desktop-pet scale, silhouette and expression are more important than tiny costume ornament.

## Character anchors

- 2.5-head chibi proportion with a large, expressive head and compact torso.
- White bobbed hair with pale-blue undersides, asymmetric curled forelock, and soft side locks.
- Deep royal-blue top hat with gold crown trim, blue bow, and teardrop jewel.
- Bright blue eyes, confident stage smile, navy/white outfit, gold trim, white gloves and stockings.
- Blue coat tails provide secondary motion without adding loose effects.

## Rendering

- Crisp dark-blue linework rather than pure black.
- Cel-shaded color blocks with restrained highlights; no soft cast shadow or bloom.
- Transparent RGBA artwork with a clean one-pixel edge at final scale.
- Ornament is grouped into large readable motifs; details smaller than two pixels at display scale are removed.

## Puppet construction

- Head, torso, arms, legs, back hair, coat tails, hat and face features overlap beneath neighboring parts to avoid joint gaps.
- Limb pivots sit inside the covered shoulder/hip area rather than on the visible contour.
- The hat is rigidly attached to the head; hair and coat tails use small spring rotations.
- Facial expression is texture/morph driven. The eye and mouth layers stay inside the head silhouette.

## Motion limits

- Head: +/- 12 degrees roll, small translation only.
- Upper arms: roughly -35 to +70 degrees from rest.
- Legs: roughly +/- 25 degrees for tiny steps and recoil.
- Hair and coat tails: low-amplitude spring motion; no detached trails or particles.
- Root translation belongs to scene movement; reaction motion belongs to `motion_root`.

## Source-of-truth references

- `characters/furina/avatar.png`: face, hair, hat, jewel and palette.
- `characters/furina/thumbnail.png`: final-size silhouette and proportion.
- `characters/furina/spritesheet.webp`: animation personality and costume consistency.
