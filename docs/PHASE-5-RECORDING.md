# Phase 5 — Screen recording execution record

Date: 2026-09-19
Branch: `phase-5/recording`
Base: `bbd831e83e46027866ed9d90a8f05db2bb9f661e` (Phase 4 head)
Status: implementation complete; a live desktop recording was not started.

## What landed

- ffmpeg is resolved in order: app-local sidecar, `PATH`, then a first-use
  download of the Gyan essentials zip into `%LOCALAPPDATA%/<id>/ffmpeg/`.
  It is not bundled.
- Windows capture uses `gdigrab` desktop, libx264, `ultrafast`, CRF 28, 30 fps.
- macOS stays `unimplemented!()` on the Recorder trait (Phase 8).
- Alt+4 / tray Record toggles recording. Stop sends `q` to ffmpeg stdin.
- Files save next to screenshots as `Forge_YYYY-MM-DD_HHMMSS.mp4`.

## Verification

- `cargo test`: 22 passed, including gdigrab-arg and mp4-name tests.
- Compat tests: 13 passed. Vite: 3855 modules.
- Live gdigrab smoke (PATH ffmpeg 8.1.1): 1s desktop capture at 3840x2160,
  libx264 ultrafast CRF 28, wrote `%TEMP%\forge-rec-test.mp4` (722 KiB).
- Did not toggle recording through the installed Tauri 1 app.
