# Furina skeletal source art

This folder contains the approved image-generation prompt, final RGBA source and QA preview for the 2.5D skeletal character. Runtime-ready transparent pieces live in `src/assets/skeleton-parts/`.

The base image locks identity and proportion. `scripts/extract-furina-puppet-from-base.py` separates that single source with normalized masks and intentional joint overlap, so all runtime pieces stay visually identical and can be reproduced without redrawing.
