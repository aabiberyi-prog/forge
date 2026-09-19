# Phase 3 — Unification execution record

Date: 2026-09-19
Branch: `phase-3/unification`
Base: `9288fbf43443ef52c0429ad7e9147c3e6db6b6fa` (Phase 2 head)
Status: complete for the Phase 3 bullets. Live GUI import click was not run.
No additional Phase 3 commit/push has been made since `27006a3` until this follow-up.

## Phase 2 live smoke (before this branch)

Isolated candidate SHA-256
`3FBA501C18E0A24230D0E28C078FCAA72A74E804D0B02E769820A6BB98FAF1B0`.
Run `a7aa53ae-d298-42fe-805d-21da787a2106`: tray Tasks opened a `Tasks` window;
hide left the process running.

## What landed

- `platform::{ocr,capture,recorder,scroll,selection,startup,permissions}` with
  macOS `unimplemented!()`. Windows capture/record/scroll return Phase 4–6
  errors instead of grabbing ShareX hotkeys.
- Tasks and clips persist in `history.db` (same SQLite file as translate
  history). JSON files are imported once. Settings stay JSON.
- Translate hydrates `apiKey` from the OS keychain. Config save writes the
  keychain first and stores an empty `apiKey` in JSON only after a read-back
  succeeds. If the keychain does not persist, plaintext is left in place.
- Hotkey registration rejects Alt+1–5 as reserved and rejects duplicates
  among the four existing Pot bindings. Config → Hotkey lists planned
  bindings. ShareX keys are not registered.
- Backup import for `com.local.desktop-todo` tasks and clips. Real
  `tasks.json` / `copy-items.json` parse into the SQLite schema in tests.

## Verification

- `cargo test`: 18 passed.
- Tauri 2 compat tests: 13 passed.
- `vite build`: run as part of this completion.

Did not click Backup → Import in the running installed app (that profile is
still Tauri 1). Did not move real OpenAI keys in `com.aabiber.pot-forge`.
