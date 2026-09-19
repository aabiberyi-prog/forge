# Phase 4 — Capture and annotation execution record

Date: 2026-09-19
Branch: `phase-4/capture`
Base: `62552286a3e5f314cdf1e948767a912efde00b6c` (Phase 3 head)
Status: implementation complete; live Alt+1 overlay was not clicked in this session.

## What landed

- Screenshot overlay keeps the existing OCR region-select path.
- Capture (`Alt+1`) and Pin (`Alt+3`) reuse that overlay, then open a 10-tool
  annotator: rectangle, ellipse, arrow, line, freehand, text, step, blur,
  highlight, crop.
- Confirm copies the PNG to the clipboard and saves
  `Forge_YYYY-MM-DD_HHMMSS.png` under `capture_save_dir` (default
  `D:\ShareX\Screenshots`). Pin opens a borderless always-on-top window.
- Tray items Capture / Pin. Hotkey settings expose the two bindings.
- Alt+2 and Alt+4 stay reserved for later phases. Alt+5 defaults to OCR
  recognise when empty.

## Verification

- `cargo test`: 20 passed.
- JS tests: 15 passed (13 compat + 2 annotation tool tests).
- `vite build`: 3855 modules.
- Did not steal the installed Tauri 1 profile. Live region-select on the
  desktop was not run.
