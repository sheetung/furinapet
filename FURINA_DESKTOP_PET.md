# Furina pet for OpenPets

This fork keeps OpenPets as the host application and packages Furina as an
independent Codex v2 pet. OpenPets branding, the built-in pet, packaging,
integrations, and plugin platform remain upstream-compatible.

## What this fork adds

- `pets/furina--lingxiaotian/`: the self-contained `pet.json`, validated
  `1536x2288` v2 spritesheet, and validation report.
- `scripts/install-furina-pet.ps1`: installs that package into the standard
  `%USERPROFILE%\.codex\pets\furina--lingxiaotian` location.
- A small generic desktop-host enhancement that uses v2 rows 9 and 10 as a
  16-direction global-cursor gaze loop while an installed pet is idle.

The gaze enhancement is deliberately pet-agnostic and isolated to
`pet-window.ts`, `pet-preload.cjs`, `look-direction.ts`, and tests. Furina is not
substituted for OpenPets' built-in pet, so future upstream merges do not need to
resolve a bundled-sprite or application-branding fork.

## Install Furina

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-furina-pet.ps1
```

Then open OpenPets **Control Center -> Pets -> Codex**, import `芙宁娜`, and set
her as the default pet. All regular OpenPets integrations and plugins continue
to target the selected default pet.

## Build and test

```powershell
pnpm install --frozen-lockfile
pnpm --filter @open-pets/desktop typecheck
pnpm --filter @open-pets/desktop build
pnpm --filter @open-pets/desktop test
```

## Sync upstream

```powershell
git fetch upstream
git switch codex/furina-desktop-pet
git merge upstream/main
```

Resolve only genuine conflicts, rerun the checks, then push to `origin`.

## License and assets

OpenPets code remains under its upstream MIT license. The Furina character
sprites are intended for personal desktop-pet use; users remain responsible for
following the relevant character and source-asset rights.
