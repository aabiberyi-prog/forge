# Phase 2 — Absorb Desktop ToDo execution record

Date: 2026-09-18
Branch: `phase-2/absorb-todo`
Base: `922c0c1ad031d46d0277667aaacc709b497e3f8a` (Phase 1 head)
Donor: `..\quick-task` @ `ba263bb` (`codex/desktop-todo-architecture`)
Status: implementation and automated tests; live panel use not yet accepted.
No Phase 2 commit, push, or PR has been made.

## What landed

- Ported tasks and copy-items (clips) commands into `src-tauri/src/features/`.
- Moved the donor `CF_HDROP` FFI behind `platform::file_clipboard` unchanged.
  macOS still returns an error instead of a stub implementation.
- Added a runtime `panel` window. Tasks and clips share that window.
- Rewrote `TitleBar`, `TodoInput`, `TodoList`, and `TodoStats` in NextUI.
  Clips list/editor are NextUI as well. Ant Design was not added.
- Did **not** port `ensure_startup_registration` (`reg.exe` / HKCU). Forge
  already uses `tauri-plugin-autostart`. Closing the panel hides it; it does
  not quit Forge.

## Verification

- `cargo test --locked --manifest-path src-tauri/Cargo.toml`: 11 passed
  (clips payload/HTML, PNG names, FileClipboard DROPFILES, panel snapshot
  guards, UTF-8 BOM JSON).
- `node --experimental-vm-modules --test .scripts/tests/tauri2-compat.test.mjs`:
  13 passed.
- `node .scripts/run-tool.cjs vite build`: passed (3851 modules).

Live panel open from the tray, task CRUD, clip copy including `CF_HDROP`,
and hide-on-close were not exercised in this session.

## Not in this phase

Startup registration, SQLite unification, keychain, and ShareX capture remain
later phases. Desktop ToDo settings stay in `panel.json` under the Forge app
data directory until Phase 3.
