# Phase 3 — Unification execution record

Date: 2026-09-19
Branch: `phase-3/unification`
Base: `9288fbf43443ef52c0429ad7e9147c3e6db6b6fa` (Phase 2 head)
Status: implementation started; not live-accepted.
No Phase 3 commit, push, or PR has been made.

## Phase 2 live smoke (before this branch)

Isolated candidate `C:\cargo-target\forge\debug\forge-migration-check.exe`
SHA-256 `3FBA501C18E0A24230D0E28C078FCAA72A74E804D0B02E769820A6BB98FAF1B0`.
Run `a7aa53ae-d298-42fe-805d-21da787a2106`: tray Tasks opened a `Tasks` window;
hide left the process running. Reopen-from-tray was not re-checked (menu probe
missed on the second right-click). Installed config hashes unchanged.

## What landed

- `platform::{ocr,capture,recorder,scroll,selection,startup,permissions}` with
  macOS `unimplemented!()`. Windows capture/record/scroll return Phase 4–6
  errors instead of grabbing ShareX hotkeys.
- Tasks and clips persist in `history.db` (same SQLite file as translate
  history). JSON files are imported once. Settings stay JSON.
- `secret_get` / `secret_set` via the OS keychain; plaintext `apiKey` fields
  are moved out of `config.json` on startup.
- Hotkey registry lists Alt+1–5 as planned ShareX bindings without registering
  them yet. Config → Hotkey shows the list and any conflict reason.
- Backup import for `com.local.desktop-todo` tasks and clips.

## Verification

- `cargo test`: 13 passed (11 prior plus two hotkey registry tests). Lockfile
  adds `rusqlite 0.32.1` and `keyring 3.6.3`.
- Tauri 2 compat tests: 13 passed.

Frontend Vite build was not re-run after the Backup/Hotkey UI edits.
