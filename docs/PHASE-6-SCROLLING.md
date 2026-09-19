# Phase 6 — Scrolling capture execution record

Date: 2026-09-19
Branch: `phase-6/scrolling-capture`
Base: `e9fc77a7a54af1cbd6646f71cc228d0bf7c6cd95` (Phase 5 head)
Status: implementation complete; partial success is the bar.

## What landed

- Alt+2 / tray Scrolling capture reuses the region overlay, then hides it and
  drives `SendInput` wheel events at the region center.
- Frames are stitched with a vertical overlap search (SAD on row strips; a
  phase-correlation-style peak). Loop stops on no new content or 40 frames.
- Result is copied and saved as a PNG next to other captures.
- macOS command returns "Windows-only"; the hotkey still no-ops there.
- ShareX-level per-app quirks are explicitly out of scope.

## Verification

- `cargo test`: 24 passed, including overlap and stitch-growth tests.
- Compat tests: 13 passed. Vite: 3855 modules.
- Live scrolling of a third-party window was not run.
