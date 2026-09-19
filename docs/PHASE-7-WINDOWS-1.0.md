# Phase 7 — Windows 1.0 execution record

Date: 2026-09-19
Branch: `phase-7/windows-1.0`
Base: `de25a11199c8e8561081f23ef9d3f6146c721e0f` (Phase 6 head)
Status: installer config, updater wiring, GitHub Actions, and migration
guide are in tree. A signed NSIS build was not produced in this session
(CI signing secrets were not used).

## What landed

- NSIS keeps per-machine install + WebView2 bootstrapper; Start Menu folder
  is `Pot Forge`.
- Updater still uses the Forge `update.json` URL and minisign public key.
  `updater/from-artifacts.mjs` writes that manifest from a local NSIS zip.
  `updater/updater.mjs` is Windows-x64-only against `aabiberyi-prog/forge`.
- `.github/workflows/windows-release.yml` builds `nsis` on `windows-latest`
  with `TAURI_SIGNING_PRIVATE_KEY`. The old `package.yml` pot-app
  homebrew/winget/docs jobs are a no-op `workflow_dispatch`.
- `docs/MIGRATION.md` covers Pot, pot-forge, Desktop ToDo, and ShareX.

## Verification

- `.scripts/tests/windows-1.0.test.mjs`: 6 passed.
- Compat tests: 13 passed.
- Did not run `tauri build -b nsis` (long, needs the CI signing secret).
- Did not create a GitHub release or tag `updater`.
