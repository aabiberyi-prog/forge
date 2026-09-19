# Forge — Merge Plan

Unify **Pot** (translate / OCR / TTS), **ShareX** (screen capture) and
**Desktop ToDo / QuickTask** (tasks + clipboard clips) into a single
cross-platform desktop app.

---

Status: Approved · ready for implementation
Owner: aabiberyi-prog
Created: 2026-09-12
Base commit: `ffcdcae` (pot-forge master)
Supersedes: nothing — first revision

---

## 0. How to use this document

This file is the implementation spec. Codex (or any agent) implements
**from this document**, not from the prose in the chat that produced it.

Rules:

1. **Phase gates are real.** Do not start phase N+1 until phase N's exit
   criteria pass. Phases 1 and 6 are the risky ones and exist precisely so
   failure is contained.
2. **One task per commit.** Do not mix Rust, frontend and config changes in
   one commit unless a task says so explicitly.
3. **Never mix phases in one branch.** One branch per phase:
   `phase-1/tauri2-migration`, `phase-2/absorb-todo`, etc.
4. **If a task's verification cannot be run, say so in the commit body.**
   Do not claim a check passed that was not executed.
5. **Ask before scope growth.** If a task turns out to need something not
   listed here, stop and raise it rather than widening silently.

---

## 1. Locked decisions

| Decision | Value | Consequence |
|---|---|---|
| Scope | Replace **only the 5 ShareX hotkeys actually in use** | Not ShareX parity. No uploaders, no 25-tool suite, no watch folders, no CLI |
| Base codebase | Port **pot-forge** to Tauri 2, absorb QuickTask into it | Tauri 1.8 → 2 migration is the single largest cost |
| License | **GPL-3.0**, public repo | Forced by Pot being GPL-3.0. Rules out Mac App Store |
| Platforms | **Windows first**, macOS phase 2 | All OS-specific code sits behind traits from day one |
| Screen recording | **In scope** (Alt+4) | ffmpeg required; fetched on first run, not bundled |
| Uploaders / destinations | **Out** | Stock ShareX config was never customised — the feature is unused |
| `.potext` plugin system | **Kept, frozen** | Existing plugins keep loading; no new plugin development |
| iOS keyboard sync | **Parked** | Separate product with its own backend; see `../quick-task/docs/superpowers/` |

### Why "5 hotkeys" is really 4 features

Measured from `HotkeysConfig.json` in the live ShareX install:

| Hotkey | ShareX job | Status in Forge |
|---|---|---|
| `Alt+1` | RectangleRegion | Extend Pot's existing screenshot overlay |
| `Alt+2` | ScrollingCapture | **New**, Windows-only, highest risk |
| `Alt+3` | PinToScreen | **New**, small — reuses QuickTask window-state code |
| `Alt+4` | ScreenRecorder | **New**, ffmpeg sidecar |
| `Alt+5` | OCR | **Already exists** — Pot's `ocr_recognize` |

After-capture behaviour to preserve: `CopyImageToClipboard` +
`SaveImageToFile`. Recording settings to preserve: libx264, `ultrafast`,
CRF 28, 30 fps.

---

## 2. Provenance and licensing

Forge is a fork of [pot-app/pot-desktop](https://github.com/pot-app/pot-desktop)
(GPL-3.0). **Upstream was archived by its owner on 2026-09-07 and is
read-only** — no further upstream merges are possible. Forge inherits full
maintenance responsibility, including WebView2 and dependency security fixes.

Full upstream history (1,542 commits) is preserved in this repo; the fork
point is `594d32e`, with 19 pot-forge commits on top ending at `ffcdcae`.

ShareX contributes **no code** — it is C# / WinForms / Direct3D 11 and cannot
be ported. Its features are reimplemented from observed behaviour, not from
source. This also means ShareX's GPL does not attach to Forge; only Pot's does.

`NOTICE` must credit pot-app contributors. QuickTask's MIT code is
GPL-compatible and is absorbed under GPL-3.0.

---

## 3. Repository layout

```text
\\192.168.1.80\work\Forge\
├── forge\                  ← this repo. The merged application
├── quick-task\             ← legacy Desktop ToDo (Tauri 2). Source for phase 2
├── docs\                   ← project-level notes
├── releases\               ← historical Desktop Todo installers
├── sync-service\           ← empty stub for the parked iOS sync work
└── Architecture document.md
```

`quick-task` stays a separate repo. It is the **donor**, read from during
phase 2 and then frozen — not deleted, not added as a git remote.

### Build performance on the NAS

Source lives on an SMB share, which is slow enough that git's auto-repack
already failed once with `Permission denied` during setup. Keep Cargo's build
churn off the share:

```powershell
$env:CARGO_TARGET_DIR = "C:\cargo-target\forge"
```

Set this before `pnpm tauri dev` / `pnpm tauri build`. If Rust builds remain
painful, the fallback is to develop against the `N:\Forge\forge` mapped-drive
path rather than the UNC path.

---

## 4. Target architecture

```text
forge/
├── src/                          # React 18 + NextUI + Tailwind + jotai
│   ├── window/
│   │   ├── Translate/            # existing
│   │   ├── Recognize/            # existing
│   │   ├── Screenshot/           # existing — extended in phase 4
│   │   ├── Capture/              # NEW — annotation surface
│   │   ├── Pin/                  # NEW — pinned image window
│   │   ├── Panel/                # NEW — tasks + clips (from QuickTask)
│   │   └── Config/               # existing — gains new sections
│   └── services/                 # translate · recognize · tts · collection
└── src-tauri/src/
    ├── platform/                 # ← THE seam. Everything OS-specific
    │   ├── mod.rs                # trait definitions
    │   ├── windows/
    │   └── macos/                # phase 8
    ├── features/
    │   ├── translate/  recognize/  tts/
    │   ├── capture/              # NEW — region, annotate, pin, record, scroll
    │   ├── tasks/                # from QuickTask
    │   └── clips/                # from QuickTask copy-items
    └── core/
        ├── store.rs              # unified config + SQLite
        ├── hotkey.rs             # single registry with conflict detection
        ├── window.rs  tray.rs
        └── secrets.rs            # OS keychain
```

### The platform trait seam

Every one of these has a Windows implementation today (in Pot or QuickTask)
and needs a macOS sibling in phase 8. Defining all of them in phase 3 — even
where macOS is `unimplemented!()` — is what keeps phase 8 additive.

| Trait | Windows | macOS (phase 8) |
|---|---|---|
| `Ocr` | `Windows.Media.OCR` via `windows` 0.58 | Apple Vision |
| `Capture` | `xcap` | `xcap` + Screen Recording TCC |
| `Recorder` | ffmpeg `gdigrab` | ffmpeg `avfoundation` |
| `ScrollCapture` | `SendInput` + stitching | **Not implemented — hide in UI** |
| `FileClipboard` | `CF_HDROP` (QuickTask FFI) | `NSPasteboard` file URLs |
| `Selection` | `selection` crate | `selection` + Accessibility TCC |
| `Startup` | `tauri-plugin-autostart` | same |
| `Permissions` | no-op | TCC prompts + status checks |

### Frontend stack resolution

pot-forge is React 18 + NextUI; QuickTask is React 19 + Ant Design. **Pot's
stack wins**; QuickTask's four components (~320 lines) are rewritten in
NextUI and Ant Design is dropped.

Do **not** attempt React 19 during this project. NextUI 2.4 targets React 18;
React 19 support lives in HeroUI (NextUI's rename). Running two framework
migrations at once is the most likely way to stall. HeroUI/React 19 is an
optional step **after** Windows 1.0.

Also: Pot uses `react-beautiful-dnd@13`, which is deprecated. QuickTask
already uses `@dnd-kit` correctly. Migrate Pot's reorder to dnd-kit and drop
the dead dependency.

---

## 5. Phases

### Phase 0 — Foundation ✅ implemented and verified

- [x] Repo created, full 1,542-commit history pushed
- [x] `upstream` remote → pot-app/pot-desktop (archived, reference only)
- [x] `pnpm-workspace.yaml` tracked
- [x] This document
- [x] `NOTICE` crediting pot-app contributors
- [x] **New minisign updater keypair**

> **Fixed locally in phase 0 (2026-09-12).** The main config, all three
> fixed-WebView2 overrides, and both manifest generators now point at Forge
> releases. All updater configs use the new Forge public key; the private
> key is protected outside Git with Windows DPAPI. See
> [the Phase 0 execution record](PHASE-0-FOUNDATION.md) for verification,
> key custody, and release limitations. No build has been distributed.

### Phase 1 — Tauri 1.8 → 2 migration · 2–4 weeks · ⚠ highest uncertainty

The dominant cost. Nothing else starts until this lands.

Implementation and live acceptance are complete on `phase-1/tauri2-migration`.
See [the Phase 1 execution record](PHASE-1-TAURI2.md). No Phase 1 commit or
push has been made. Phase 2 has not started.

| Area | Work |
|---|---|
| Config | `tauri.allowlist` → `capabilities/*.json` ACL; `devPath`→`devUrl`; `distDir`→`frontendDist`; `package.*` → top level |
| Core → plugin | `global-shortcut`, `clipboard`, `dialog`, `shell`, `http`, `os`, `notification`, `process`, `updater` all became separate v2 plugins — ~10 rewrites |
| Existing plugins | 6 deps on `plugins-workspace branch=v1` → crates.io v2. `fs-watch` folds into `tauri-plugin-fs` |
| Rust types | `Window`→`WebviewWindow`, `WindowBuilder`→`WebviewWindowBuilder`. Touches all 462 lines of `window.rs` |
| Tray | Static `systemTray` config → `TrayIconBuilder` in code |
| JS | `@tauri-apps/api` 1.6 → 2.x; `appWindow` → `getCurrentWebviewWindow()` |
| CSP | Tighten Pot's `script-src * 'unsafe-eval'` and the `--disable-web-security` daemon window. Keep `worker-src blob:` + `wasm-unsafe-eval` for tesseract.js |
| Crates | Replace `screenshots =0.7.2` (pinned, unmaintained) with **`xcap`** — same author, maintained, all three OSes. Also de-risks phase 8 |

**Reference implementation:** `..\quick-task\src-tauri\src\lib.rs` is a
working Tauri 2 app by the same owner. Its tray, window-state and
clipboard-plugin code are the migration's worked examples — read it before
guessing at v2 APIs.

**Exit criteria — every pre-existing Pot feature still works:**
`Alt+W` OCR-translate · `Alt+Q` selection helper · Edge TTS · the configured
OpenAI endpoint · config import · `.potext` plugin loading · tray · autostart
· single instance.

**Kill criterion:** if this exceeds 4 weeks with no end in sight, stop and
reconsider building on `quick-task` instead. Do not let it drift.

### Phase 2 — Absorb Desktop ToDo · 1–2 weeks

Implementation is in progress on `phase-2/absorb-todo` from the Phase 1 head.
See [the Phase 2 execution record](PHASE-2-ABSORB-TODO.md).

- Port `tasks` and `clips` (copy-items) commands from
  `..\quick-task\src-tauri\src\lib.rs` into `features/`
- Rewrite `TodoInput`, `TodoList`, `TodoStats`, `TitleBar` in NextUI
- Tasks + Clips become panels in one transparent window created at runtime
- Move the `CF_HDROP` FFI behind `platform::FileClipboard` **unchanged** — it
  is correct code, it just needs a macOS sibling later
- **Delete `ensure_startup_registration`.** The `reg.exe` / HKCU code is
  redundant once `tauri-plugin-autostart` (already a Pot dependency) handles
  both platforms. Net deletion

> Note: the donor code lives on branch `codex/desktop-todo-architecture` at
> commit `ba263bb`, **not** on `main`. The copy-items subsystem was
> uncommitted until this plan was written.

### Phase 3 — Unification · 1–2 weeks

- **Storage:** one SQLite DB via `tauri-plugin-sql` (tasks, clips, capture
  history, translate history). Settings stay JSON for hand-editability
- **Migration:** one-time importer from all three existing config dirs —
  `com.local.desktop-todo`, `com.aabiber.pot-forge`, `com.pot-app.desktop`.
  Extend the existing pot-forge import wizard rather than writing a new one
- **Secrets → OS keychain** (`keyring` crate → Credential Manager / macOS
  Keychain). The current Pot config stores the OpenAI API key in plaintext
  JSON under `%APPDATA%`; migrate it out on first run and overwrite the
  plaintext copy
- **One hotkey registry** with conflict detection at registration time, and a
  settings UI that shows which binding failed and why
- Define **all** `platform::*` traits now, macOS arms `unimplemented!()`

Default bindings preserve existing muscle memory exactly:

| Binding | Action | From |
|---|---|---|
| `Alt+1` | Capture region | ShareX |
| `Alt+2` | Scrolling capture | ShareX |
| `Alt+3` | Pin to screen | ShareX |
| `Alt+4` | Screen recording | ShareX |
| `Alt+5` | OCR recognise | ShareX |
| `Alt+W` | OCR translate | Pot |
| `Alt+Q` | Selection translate | pot-forge |

### Phase 4 — Capture and annotation · 3–4 weeks

- Extend Pot's existing screenshot overlay with an annotation layer
- **Annotation MVP — 10 tools, not ShareX's 20:** rectangle, ellipse, arrow,
  line, freehand, text, step counter, blur/pixelate, highlight, crop
- After-capture pipeline: copy to clipboard + save to configured folder
  (currently `D:\ShareX\Screenshots`)
- Pin-to-screen: borderless always-on-top window holding the bitmap.
  QuickTask's window-state clamping code is the reference

### Phase 5 — Screen recording · 1–2 weeks

- ffmpeg as a Tauri sidecar, **fetched on first use** (~70–90 MB otherwise)
- Windows `gdigrab`; preserve libx264 / ultrafast / CRF 28 / 30 fps
- macOS `avfoundation` behind the same `Recorder` trait

### Phase 6 — Scrolling capture · 1–3 weeks · ⚠ highest risk

- `SendInput` wheel events into the target window, frame capture,
  phase-correlation stitching
- **Windows-only.** macOS TCC does not permit driving a foreign app's scroll;
  the UI must hide this action on macOS rather than fail at runtime
- Scheduled last so it can slip without blocking 1.0
- **Partial success is acceptable.** ShareX has years of per-app quirk
  handling here; matching it is not the bar

### Phase 7 — Windows 1.0 · 1–2 weeks

NSIS installer · updater pointed at Forge releases · GitHub Actions build ·
migration guide for existing Pot / ShareX / Desktop Todo users.

### Phase 8 — macOS · 3–6 weeks + signing setup

- Permissions onboarding: Screen Recording, Accessibility, Input Monitoring
- Apple Vision OCR replacing `Windows.Media.OCR`
- `NSPasteboard` file URLs replacing `CF_HDROP`
- Universal binary via `--target universal-apple-darwin`
- Apple Developer Program ($99/yr), Developer ID cert, `notarytool`, hardened
  runtime + screen-capture entitlements
- GPL-3.0 is fine for a notarized DMG — only the App Store conflicts

---

## 6. Effort summary

| Phase | Estimate |
|---|---|
| 0 Foundation | done (+ keypair, NOTICE) |
| 1 Tauri 2 migration | 2–4 weeks ⚠ |
| 2 Absorb ToDo | 1–2 weeks |
| 3 Unification | 1–2 weeks |
| 4 Capture + annotation | 3–4 weeks |
| 5 Recording | 1–2 weeks |
| 6 Scrolling capture | 1–3 weeks ⚠ |
| 7 Windows 1.0 | 1–2 weeks |
| **Windows 1.0 total** | **~11–20 weeks** |
| 8 macOS | +3–6 weeks |

The range is wide because a Tauri 2 ACL migration on a codebase this size is
hard to estimate from outside. **Re-estimate after the first week of phase 1**
— that week is worth more than any amount of further planning.

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | Phase 1 stalls | 4-week kill criterion; `quick-task` is a working Tauri 2 reference |
| 2 | Upstream is archived — all maintenance is now ours | Argues *for* consolidation; budget ongoing dependency upkeep |
| 3 | Public repo + real API keys in dev configs | Keychain migration in phase 3; audit `.gitignore` before every push |
| 4 | Scrolling capture may never work well | Windows-only, scheduled last, partial success accepted |
| 5 | SMB share degrades Rust builds | `CARGO_TARGET_DIR` on local disk; `N:\` fallback |
| 6 | Updater still points at upstream Pot | **Fix in phase 0** before any distributed build |

---

## 8. Open questions

1. Product name for UI strings and installer — "Forge" is the repo and folder
   name; is it also the user-facing product name?
2. Bundle identifier: keep `com.aabiber.pot-forge` (preserves existing user
   configs) or move to `com.aabiber.forge` (clean, needs config migration)?
3. Do translate / OCR / TTS stay as separate floating windows, or fold into
   one panel alongside tasks and clips?
4. Is `D:\ShareX\Screenshots` still the wanted capture destination?

---

## 9. Source material

| App | Location | Read-only reference for |
|---|---|---|
| Pot (official) | `%APPDATA%\com.pot-app.desktop` | Live config, real usage |
| pot-forge | `C:\Users\AABIBER\Documents\pot-forge` | Fork source (shallow clone) |
| ShareX | `%USERPROFILE%\Documents\ShareX` | `HotkeysConfig.json`, `ApplicationConfig.json` |
| QuickTask | `..\quick-task` @ `ba263bb` | Tauri 2 reference + donor code |
