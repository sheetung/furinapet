# Furina Desktop Pet

This repository is a Furina-only Windows desktop-pet distribution powered by
the OpenPets host. It keeps the OpenPets tray, plugin platform, agent
integrations, bubbles, movement, multi-monitor behavior, and settings while
shipping a single protected built-in pet: Furina.

## Distribution boundary

`apps/desktop/src/distribution.ts` is the central specialization switch. The
distribution:

- uses Furina's validated Codex v2 atlas as the built-in/default pet;
- uses the final two atlas rows for 16-direction global-cursor gaze;
- removes the Professor Hoot spritesheet and thumbnail from packaged assets;
- suppresses the remote pet catalog, Codex pet discovery, and local pet import;
- normalizes persisted pet state back to the protected built-in Furina pet;
- leaves the plugin catalog and bundled official plugins enabled;
- checks `sheetung/furinapet` for application updates.

The canonical standalone pet package and deterministic validation report remain
under `pets/furina--lingxiaotian/`.

## Local development

```powershell
pnpm install --frozen-lockfile
pnpm --filter @open-pets/desktop typecheck
pnpm --filter @open-pets/desktop build
pnpm --filter @open-pets/desktop test:build
```

## Automatic Windows packaging

`.github/workflows/build-furina-windows.yml` builds an unsigned x64 NSIS
installer on pushes, pull requests, and manual dispatches. Download it from the
workflow run's `furina-desktop-pet-windows-x64` artifact.

Pushing a `v*` tag also creates a GitHub Release containing the installer and
`SHA256SUMS.windows.txt`:

```powershell
git tag v3.4.0-furina.1
git push origin v3.4.0-furina.1
```

## Sync upstream

```powershell
git fetch upstream
git switch codex/furina-desktop-pet
git merge upstream/main
```

Most OpenPets features remain untouched. Conflicts should normally be limited
to the small distribution integration surface and desktop packaging metadata.

## License and assets

OpenPets code remains under its upstream MIT license. The Furina character
sprites are intended for personal desktop-pet use; users remain responsible for
following the relevant character and source-asset rights.
