# Review fixes — 2026-09-19

Scope: all 16 findings from the review of `897e363ba`, within the selected screenshot and TODO requirements. Branch: `repair/phase-6-accept`. No running-app replacement, live import/restore, credential migration, or release is included. The user subsequently authorized committing and pushing these fixes.

| Finding | Change | Verification |
|---|---|---|
| R01 | SQLite-aware WAL backup and restore; staged ZIP validation. | WAL backup and open-connection restore regressions. |
| R02 | Transactional clip/image rows, immutable new asset paths, pending-asset cleanup. | Failed insert retains old references. |
| R03 | Preserve legacy lifecycle events and display/search them after restore. | Native lifecycle and dated-history tests. |
| R04 | Preflight assets; stop incomplete imports; repair absent copies on retry; commit ledger with data. | Missing-asset, idempotence, interruption fixtures. |
| R05 | Independent startup registration, durable disabled bindings, edit cancellation/rollback. | Failed-first-binding fixture; native acceptance pending. |
| R06 | Editor shortcuts ignore editable controls and IME composition. | Actual component-handler regression. |
| R07 | Resize handles and font/arrow/step/magnification properties are connected to objects. | Actual pointer/property handler tests. |
| R08 | Canonical freehand/reverse-region resizing and rotated hit testing. | Geometry regressions. |
| R09 | Bounded sampled matching, cancellable matching/stitching, Escape watcher, tray progress/cancel, partial-result warnings. | Cancellation and 1080p fixtures; target-app tests pending. |
| R10 | Older pin history is accessible through paging; recordings are filtered and images validated. | Reader fixture exceeding 200 records. |
| R11 | DPI-aware bounds, aspect ratio, proportional initial fit, scrollable zoomed content. | Negative-monitor/high-DPI layout tests. |
| R12 | Reopening the panel reapplies its saved always-on-top setting. | Source correction; native acceptance pending. |
| R13 | Deterministic fixtures and execution-derived acceptance; publication requires source/artifact-bound native evidence. | Status/mismatch tests and CI wiring. |
| R14 | Independent review identity for profiles, cache, backups, secrets, helpers, and updater behavior. | Configuration test and review build. |
| R15 | Decoded-frame validation, pinned/checksummed FFmpeg pair, staged installation, background recording work. | Invalid media/checksum tests and explicit synthetic video test. |
| R16 | Visible operation errors, retained drafts, localized affected panel controls. | Panel/history tests and frontend build. |

The recorder reuses the `sha2` package already in Cargo.lock. Its versioned package checksum was verified against [Gyan's 8.1.2 checksum](https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip.sha256). Tests do not download or install tools into the live profile.

## Final verification

- Main verification: 47 JavaScript tests and 53 Rust tests passed; zero failures. The credential-write and live-import tests were excluded. The synthetic video test was initially ignored, then run explicitly and passed using installed FFmpeg/ffprobe with generated color input only. Total executed passing checks: 101.
- The independent debug Review application built successfully, including the frontend and native executable. It was not launched or installed. The existing running app remains separate.
- Artifact: C:/cargo-target/forge/debug/Pot Forge Review.exe, product Pot Forge Review 3.0.8, 100,313,088 bytes. SHA-256: AE89D37CD47694A996116AD7F36320420A85ADEF326DD1DF40839DAA274F2C27.
- Source fingerprint before/after tests and build: 6def180b2f2d6562acc5b1b8a2600d0bb61c9f5dd3b7c80601ce4baeb2f9fdcf. Base HEAD is 897e363ba; changes are uncommitted. Machine results are saved in the ignored verification.json file.
- Both supported locale files contain all literal keys used by the affected panels. Git diff whitespace check passed. Build warnings include existing deprecated shell API and test-only unused helpers; native visual acceptance is still outstanding.

Desktop screenshots, real clipboard/hotkey/window behavior, installation/update, credential persistence, and live provider calls remain unverified and are not counted as passes. Release readiness is false; publication remains gated.

## Handoff

Suggested commit: fix: preserve history and harden capture workflows.

Target branch/remote: repair/phase-6-accept → origin/repair/phase-6-accept. Verification above records the pre-commit worktree; the user subsequently selected commit and push. The installed application remains unchanged. The implementation results were saved before the earlier requested shutdown.

## Files for the proposed commit

- .github/workflows/ci.yml
- .github/workflows/windows-release.yml
- .gitignore
- .scripts/acceptance.mjs
- .scripts/check-release-acceptance.mjs
- .scripts/source-identity.mjs
- .scripts/tests/acceptance-ledger.test.mjs
- .scripts/tests/editor-regressions.test.mjs
- .scripts/tests/panel-history.test.mjs
- .scripts/tests/pin-layout.test.mjs
- .scripts/tests/providers-status.test.mjs
- .scripts/tests/windows-1.0.test.mjs
- .scripts/verify.mjs
- docs/ACCEPTANCE.json
- docs/ACCEPTANCE.md
- docs/CANDIDATE.md
- docs/REVIEW-FIXES.md
- package.json
- src-tauri/Cargo.lock
- src-tauri/Cargo.toml
- src-tauri/src/backup.rs
- src-tauri/src/config.rs
- src-tauri/src/features/capture.rs
- src-tauri/src/features/clips.rs
- src-tauri/src/features/db.rs
- src-tauri/src/features/hotkeys.rs
- src-tauri/src/features/import_todo.rs
- src-tauri/src/features/json_store.rs
- src-tauri/src/features/merge.rs
- src-tauri/src/features/panel.rs
- src-tauri/src/features/pins.rs
- src-tauri/src/features/recorder.rs
- src-tauri/src/features/scroll.rs
- src-tauri/src/features/secrets.rs
- src-tauri/src/features/tasks.rs
- src-tauri/src/hotkey.rs
- src-tauri/src/main.rs
- src-tauri/src/review_regressions.rs
- src-tauri/src/selection_helper.rs
- src-tauri/src/tray.rs
- src-tauri/src/window.rs
- src-tauri/tauri.review.conf.json
- src/i18n/locales/en_US.json
- src/i18n/locales/zh_CN.json
- src/services/provider-status.js
- src/window/Config/pages/Hotkey/index.jsx
- src/window/Panel/components/CopyItemEditor.jsx
- src/window/Panel/components/CopyList.jsx
- src/window/Panel/components/HistoryList.jsx
- src/window/Panel/components/TitleBar.jsx
- src/window/Panel/components/TodoInput.jsx
- src/window/Panel/components/TodoList.jsx
- src/window/Panel/components/TodoStats.jsx
- src/window/Panel/history.js
- src/window/Panel/index.jsx
- src/window/Panel/style.css
- src/window/Pin/History.jsx
- src/window/Pin/index.jsx
- src/window/Pin/layout.js
- src/window/Screenshot/Annotator.jsx
- src/window/Screenshot/draw.js
- src/window/Screenshot/index.jsx
- src/window/Screenshot/regions.js
