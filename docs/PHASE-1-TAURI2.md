# Phase 1 — Tauri 2 migration execution record

Date: 2026-09-12
Branch: `phase-1/tauri2-migration`
Base: `01e16a3690db6f9220712b89e1622ffec1c70ace`
Status: implementation, automated verification, and live acceptance complete.
No Phase 1 commit, push, PR, merge, or release has been made.

## Foundation already delivered

The user approved the two Phase 0 commits and their push:

- `951bc3c` — `docs: credit pot-app contributors` (`NOTICE`).
- `01e16a3` — `fix(updater): isolate Forge update trust and endpoints`
  (the other 9 Phase 0 files).

Both were pushed to `origin/phase-0/foundation`, and the remote head was
read back and matched the local head before starting this phase.

## Implementation

The migration follows the [official Tauri guide](https://v2.tauri.app/start/migrate/from-tauri-1/)
and the QuickTask donor's tray/window examples. React 18, NextUI, the
`Pot Forge` product name, and `com.aabiber.pot-forge` identifier are retained.

- Converted all 7 Tauri configuration files to v2; retained the Phase 0
  updater key and Forge endpoints, including fixed-runtime overrides.
  Kept the HTTPS webview origin on Windows to preserve origin-based storage.
- Replaced the allowlist with a capability for the 6 existing window
  labels. Filesystem access is scoped to app configuration/cache paths;
  HTTP retains the configurable HTTP/HTTPS endpoints supported by v1.
- Migrated core APIs and existing plugins to v2. Replaced `fs-watch` with
  `tauri-plugin-fs` watching, and changed store loading/reloading and missing
  values to match v2. Inspected all 12 frontend `store.get` call sites.
- Migrated Rust windows, events, notifications, global shortcuts, clipboard,
  updater, and tray construction. Retained all 154 tray labels in 11 languages.
  Shortcut callbacks run on key press, not also on release.
- Replaced `screenshots` with `xcap` 0.9.8. Screenshot output remains in
  the same app-cache filenames used by cropping and OCR.
- Removed `--disable-web-security` and JavaScript `unsafe-eval`. CSP retains
  blob workers and WebAssembly support. Installed plugin scripts are loaded
  through blob ES modules, with their v1 HTTP/filesystem utility contracts
  preserved. No new plugin product was introduced.
- Added a v1 HTTP compatibility layer for existing providers and frozen
  plugins. It preserves JSON/text/binary responses, form encoding, multipart
  files, query parameters, timeout units, native headers, and client methods.
  The backend's `unsafe-headers` feature preserves existing native headers
  such as Bing's Referer; webview security remains enabled.
- Moved OpenAI/Gemini streaming, ChatGLM, and Ollama requests to the native
  HTTP transport after removing the browser security bypass. Fixed OpenAI's
  stream framing and UTF-8 decoding for arbitrary response chunk boundaries.
- Migrated updater progress to the v2 update resource/callback API.
- Kept Rust log output at Info level instead of the v2 builder's Trace default.
  Notification failures are logged instead of terminating the application.

Tauri 2 signing uses `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; the Phase 0 private key remains in
its protected local vault. No signing secrets or release workflows were
changed here. The inherited CI/release pipeline remains Phase 7 work.

Native acceptance and compatibility tests exposed these additional issues:

1. Cargo initially resolved HTTP 2.4.2 while npm supplied HTTP 2.6.0. Their
   stream IPC protocols differ: a channel argument versus per-chunk reads.
   Set Rust minimums to HTTP 2.6.0 and updater 2.11.0, updated the lockfile,
   and added a check across all 14 plugin client/backend pairs.
2. A one-byte-chunk OpenAI test returned an empty result instead of
   `Hello 你好`. The replacement parser passes that same test, including
   split UTF-8 bytes and mixed LF/CRLF event boundaries.
3. The native fixture exposed a custom-port permission regression:
   `http://**` and `https://**` allow the default port only under URLPattern
   semantics. Replaced them with `http://*:*/*` and `https://*:*/*` so
   existing configurable endpoints, including local providers, work on
   explicit ports. The native JSON/SSE check now passes; 8 allowed URL
   cases and 5 rejected non-HTTP scheme cases also passed.
4. Translation sizing passed `outerSize()` back to `setSize()`, which takes
   client dimensions. Repeated resize events grew the window across the
   screen and prevented reliable interaction. Content fitting and remembered
   sizes now use inner dimensions, and unchanged heights do not trigger
   another resize. A high-DPI regression test and stable, clickable native
   windows verified the fix.
5. An isolated app with its selection helper deliberately disabled could
   still stop the installed app's shared helper on exit. It now skips helper
   shutdown when its configured helper script is absent. The existing helper
   remained alive through the isolated app's import/restart workflow.
6. Tray **Quit** reached `handle_menu` and logged `Quit App`, but Tauri 2's
   `app.exit(0)` did not terminate the process while the HTTP server thread
   was still running. Quit now uses `std::process::exit(0)` after shortcut
   unregister and helper shutdown. Native retest then exited with code 0.

## Build commands on this workstation

The installed pnpm 11 fails when registering UNC-backed projects, and
default CMD lifecycle scripts lose the UNC working directory. Merely using
a mapped drive was insufficient because pnpm expanded it back to UNC.

The project pins pnpm 9.15.9 (the existing CI uses pnpm 9), enables its
portable shell and a hoisted/copy installation layout, and includes a
small tool runner that restores an existing mapped drive before starting
Vite/Tauri. The runner verifies the mapping with native real paths.
It does not create a drive mapping or modify global package-manager settings.

From the repository, the direct commands avoid the globally installed pnpm:

```powershell
$env:CARGO_TARGET_DIR = 'C:\cargo-target\forge'
node .scripts/run-tool.cjs vite build
node --experimental-vm-modules --test .scripts/tests/tauri2-compat.test.mjs
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo build --locked --features custom-protocol --manifest-path src-tauri/Cargo.toml
```

The pnpm 9 launcher was also exercised from a local working directory:

```powershell
npm exec --yes --package=pnpm@9.15.9 -- pnpm --dir Y:\Forge\forge build
```

For fresh dependency installation, use pnpm 9 and a local store path.
Do not use pnpm 11's automatic version switching on this NAS path; it also
attempts to create the incompatible UNC junctions.

## Verification and limits

- Scanned all 186 original frontend source files and the Rust sources for
  the migration. The final frontend build transformed 3,840 modules.
- Production frontend build and Rust checking passed.
- The complete Tauri CLI command `node .scripts/run-tool.cjs tauri build
  --debug --no-bundle` also passed, including its frontend build hook. It
  produced `C:\cargo-target\forge\debug\Pot Forge.exe` with the normal
  product name/identifier. This final executable has not been installed or
  launched against the real profile.
- All 13 compatibility tests passed. Coverage includes high-DPI window sizing, all 14 plugin
  version pairs, fragmented OpenAI streaming, the legacy HTTP formats,
  multipart OCR files, timeout/redirect behavior, and all 4 plugin entry types.
- A Windows executable built with an isolated identifier opened Settings
  and persisted settings in `com.aabiber.forge-migration-check`. The original
  installed Pot Forge process remained running. This was a smoke test on
  an earlier candidate, not acceptance of the final network changes.
- The owned test process was stopped; its HTTP/debugging listeners closed.
- Single-instance behavior passed on the updated isolated build: the second
  process exited with code 0 and the primary stayed alive. Both owned test
  processes were then stopped, with the installed application still running.
- The extended native JSON/SSE fixture test **passed both cases** after
  repairing the custom-port scope. Each fresh input produced exactly one
  fixture request, no webview Origin header, and exactly one correct
  history result. The isolated profile's hash matches its backup after
  cleanup; no test processes, WebView2 processes, listeners, or lock remain.
  The installed app remained running. An earlier combined setup command
  was rejected with `blocked by policy`; the prepared runner subsequently
  executed successfully when the user instructed the agent to run it.
- The later native acceptance run imported official Pot settings into the
  isolated profile and exercised the configured OpenAI endpoint and voices.
  Credentials stayed in the application configuration and were not printed
  or included in reports/backups. The isolated profile was restored afterward.
  The installed and official configuration files both matched their pre-test
  hashes. The installed app was temporarily closed for port/hotkey checks and
  restored on port 60828. No installer or updater installation was performed.
- The build still reports the inherited Browserslist-data/chunk-size warnings
  and the supported-but-deprecated shell open API. React/NextUI and release
  pipeline upgrades remain outside this phase's implementation.

The current debug executable is a developer build, not a release installer.
Build artifacts remain outside Git under `C:\cargo-target\forge`.
Final executable: `C:\cargo-target\forge\debug\Pot Forge.exe`, product
version `3.0.8`. SHA-256 after the tray Quit fix:
`94771356FABD7B7FA1FF88D025EED7DD0C3553A735ECCDCB673FE9C70D17843F`.
The previous handoff hash `DEFAE709…` does not include the Quit fix.

## Live exit gate — 9 of 9 criteria passed

Automated checks and the Settings smoke test do not substitute for these
live checks. Close the installed Pot Forge before hotkey testing to avoid
conflicts. Preserve existing settings before using the candidate with the
real identifier. Do not start Phase 2 until all 9 rows pass.

| Criterion | Evidence / remaining requirement |
|---|---|
| Alt+W OCR-translate | **Passed:** native shortcut, new region selection, exact recognized English sentence, and correct Chinese output. See the tight-crop limitation below. |
| Alt+Q selection helper | **Passed:** fresh Notepad selection produced one translation window and one matching history row through the existing helper. |
| Edge TTS | **Passed:** configured English and Chinese voices, 24% volume, synthesis output, and nonzero playback activity from the test app's audio session. |
| Configured OpenAI endpoint | **Passed:** configured non-streaming OpenAI service returned the expected Chinese translation, visible in the app and saved once in history. The configured Qwen instance was disabled and was left disabled. |
| Config import | **Passed:** 59 source keys accounted for; 58 matched exactly and the TTS list gained the intended Edge TTS entry. Opacity and endpoint settings were preserved; automatic restart completed. |
| `.potext` loading | **Passed:** installed the published Lingva 2.0.0 package through the native file picker, verified all 3 files matched the archive, configured a loopback fixture, and executed its unchanged entry point. One request produced one correct visible/history result. |
| Tray | **Passed:** Windows 11 overflow icon named with the versioned Alt+Q tooltip; left-click opened Config; right-click menu contained all 9 actions plus Auto Copy; Clipboard Monitor toggled config true→checked→false; Input Translate and Config menu items opened those windows; overflow close/reopen still showed the icon; Quit exited code 0 and released port 60829. Run `254da674-7fa0-4c7e-9d04-add80ef4595c`. |
| Autostart | **Passed:** enabled through Settings, verified the registration pointed to the test executable, disabled again, and verified removal. Installed Pot Forge's entry remained unchanged. |
| Single instance | **Passed:** second isolated candidate exited with code 0; the primary remained running. |

Native evidence is recorded under `%TEMP%\forge-live-acceptance`:

- Run `317e30ad-1a32-49d3-93a6-b59350c3339a`: configured endpoint, both
  voices, autostart, official import/restart, and OCR translation.
- Run `420ec81b-cc98-424d-b1c3-fd36fb1d4d69`: selection-helper acceptance
  with the normal `Pot Forge.exe` process name. The helper otherwise starts
  the installed executable, which can steal focus from an isolated test.
- Run `7c4209ca-30d2-4c0f-8655-004a535e6298`: published Lingva package
  installation and execution, with no real provider credentials in the test
  profile. Input `FORGE_NATIVE_PLUGIN_7330/测试` returned
  `PLUGIN_OK_7330/完成`, verifying the package's slash escaping as well.
- Run `254da674-7fa0-4c7e-9d04-add80ef4595c`: tray icon, left-click Config,
  full native menu, clipboard-monitor checked-state round trip, Input
  Translate, Config, overflow reopen, and Quit. Isolated candidate SHA-256
  `5258308DE75DA9250E8ECB45FB9EC90E882A375AD037958347AAB44AB94C27F9`, retained
  at `C:\cargo-target\forge\native-http\5258308de75d\forge-migration-check.exe`.
  Installed config hashes were unchanged; helper PID 11888 and the autostart
  entry for `D:\Pot Forge\Pot Forge.exe` were unchanged. The installed app
  was restored on PID 54256.

English TTS used `en-US-AriaNeural` (51,840 bytes); Chinese used
`zh-CN-XiaoxiaoNeural` (38,448 bytes). A read-only Core Audio meter observed
62 and 50 nonzero samples respectively from the test app's audio process.
No audio was recorded. The autostart registration, isolated credentials,
test processes/WebViews, run locks, and generated screenshot cache were
removed or restored after acceptance. Existing Notepad content was preserved.

Package provenance: [official plugin catalog](https://pot-app.com/plugin.html)
and [Lingva 2.0.0 release](https://github.com/pot-app/pot-app-translate-plugin-template/releases/tag/2.0.0).
Archive SHA-256:
`3FEF096F78D70510E8E955BDB3991A9A396368861F895D5C30A29FCF8E02C58F`.
All executable JavaScript and metadata were inspected; the SVG contained only
internal references. The package was not modified. An earlier Tatoeba package
was excluded after static inspection found an undefined variable in its entry
point; no changes were made to upstream plugins.

Cleanup exception: automatic approval review rejected both recursive cleanup
and the narrower removal of the three named plugin files with `blocked by
policy`, without a detailed reason. `info.json`, `main.js`, and `lingva.svg`
remain only under the isolated profile's
`plugins/translate/plugin.com.pot-app.lingva` directory. The restored test
configuration does not select this plugin, and its app/server are stopped.
Do not bypass the restriction through another executor. The original profiles,
installed application, and installed autostart entry are unaffected.

OCR limitation: a tight 485×29 crop returned empty text in both the app and
the standalone Windows OCR diagnostic. A 799×110 crop containing the same
sentence with margin returned the exact text and translated successfully.
This was reproduced independently of Tauri; it is not counted as a fixed
migration defect. Further small-region OCR improvements remain deferred.

Stop acceptance on missing/incorrect output, lost settings, hotkey conflicts,
or duplicate execution. The live gate is now 9/9. Keep the installed version
available until Phase 1 is committed. The plan's first-week re-estimate date
is 2026-09-19; the four-week stop criterion is retained but is not triggered.

The native HTTP check selects the local fixture provider only in
`com.aabiber.forge-migration-check`, keeps clipboard copy/monitoring and
hotkeys disabled, and starts the loopback fixture on port 60830. It sends
fresh `FORGE_NATIVE_...` inputs through the test app and reads back the
expected JSON/SSE results from its isolated history using a dummy credential.
This scope is already approved and was executed by the agent.

### Repeatable native HTTP check

Run this command in a Windows PowerShell terminal and leave its test windows
alone until it finishes:

```powershell
node "\\192.168.1.80\work\Forge\forge\.scripts\tests\run-native-http.cjs" --run
```

The runner verifies the isolated executable's SHA-256, refuses occupied ports
60829/60830, and runs one fresh JSON case and one fresh SSE case. Each case
requires exactly one fixture request and one matching history result. It
terminates only its own child processes and restores the isolated profile's
original contents after the test app stops. It records results at
`%TEMP%\forge-native-http-manual\latest-result.json`, with detailed logs and a
profile backup in that directory's per-run subfolder. A failed cleanup retains
the run lock and reports the required attention in the result file.

Initial successful run: `4a6a36b7-57da-4934-8b49-9f56c7369702`, 2026-09-12.
The later candidate also passed both cases in run
`5eebb133-fb03-4daf-92df-41224dcb3c94`, with profile restoration and no cleanup
errors.
JSON returned `FORGE_JSON_OK_7319`; fragmented UTF-8/SSE returned
`流式通过_7319`. Both results were read back from the application's history.
The isolated executable is retained at
`C:\cargo-target\forge\native-http\f025725010f6\forge-migration-check.exe`,
SHA-256 `F025725010F62BFFFEBEDC49171E146158685702D9CE13C2480ABBB8488DC08A`.
Keeping this fingerprinted copy prevents a normal build from replacing it.

The runner also handles the observed Windows MSIX directory virtualization:
Node sees the nominal roaming profile through the Codex package cache,
whereas Python needs the verified physical directory to read SQLite. Only
that exact package cache and isolated app ID are accepted, with symlink
checks retained. This fixture verifies native transport and application
result persistence; the configured real endpoint remains a separate
acceptance requirement.

## Proposed commit grouping after acceptance

Keep Phase 1 changes on this branch and obtain separate commit/push approval:

1. Build manifests/configuration, capabilities, and the NAS runner.
2. Rust runtime/window/plugin/capture migration.
3. Frontend API compatibility, streaming fixes, and associated tests.
4. Execution/acceptance documentation.

Do not combine this phase with the QuickTask absorption or SQLite/keychain
unification. The inherited release workflow issues remain recorded in
[the Phase 0 record](PHASE-0-FOUNDATION.md) for Phase 7.


## Changed-file inventory

137 files were reviewed for scope and secrets. Generated schemas, build artifacts, dependencies, and signing secrets are excluded from Git.

- `.npmrc`
- `.scripts/run-tool.cjs`
- `.scripts/tests/openai-fixture.cjs`
- `.scripts/tests/run-live-acceptance.cjs`
- `.scripts/tests/run-native-http.cjs`
- `.scripts/tests/tauri2-compat.test.mjs`
- `docs/MERGE-PLAN.md`
- `docs/PHASE-1-TAURI2.md`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `src-tauri/.gitignore`
- `src-tauri/capabilities/migrated.json`
- `src-tauri/Cargo.lock`
- `src-tauri/Cargo.toml`
- `src-tauri/examples/audio_meter.rs`
- `src-tauri/examples/http_transport.rs`
- `src-tauri/examples/ocr_image.rs`
- `src-tauri/src/clipboard.rs`
- `src-tauri/src/cmd.rs`
- `src-tauri/src/config.rs`
- `src-tauri/src/hotkey.rs`
- `src-tauri/src/main.rs`
- `src-tauri/src/screenshot.rs`
- `src-tauri/src/selection_helper.rs`
- `src-tauri/src/server.rs`
- `src-tauri/src/system_ocr.rs`
- `src-tauri/src/tray.rs`
- `src-tauri/src/updater.rs`
- `src-tauri/src/window.rs`
- `src-tauri/tauri.conf.json`
- `src-tauri/tauri.linux.conf.json`
- `src-tauri/tauri.macos.conf.json`
- `src-tauri/tauri.windows.conf.json`
- `src-tauri/webview.arm64.json`
- `src-tauri/webview.x64.json`
- `src-tauri/webview.x86.json`
- `src/App.jsx`
- `src/components/WindowControl/index.jsx`
- `src/hooks/useConfig.jsx`
- `src/main.jsx`
- `src/services/collection/anki/Config.jsx`
- `src/services/collection/anki/index.jsx`
- `src/services/collection/eudic/Config.jsx`
- `src/services/collection/eudic/index.jsx`
- `src/services/recognize/baidu_accurate/Config.jsx`
- `src/services/recognize/baidu_accurate/index.jsx`
- `src/services/recognize/baidu_img/Config.jsx`
- `src/services/recognize/baidu_img/index.jsx`
- `src/services/recognize/baidu/Config.jsx`
- `src/services/recognize/baidu/index.jsx`
- `src/services/recognize/iflytek_intsig/Config.jsx`
- `src/services/recognize/iflytek_intsig/index.jsx`
- `src/services/recognize/iflytek_latex/Config.jsx`
- `src/services/recognize/iflytek_latex/index.jsx`
- `src/services/recognize/iflytek/Config.jsx`
- `src/services/recognize/iflytek/index.jsx`
- `src/services/recognize/simple_latex/Config.jsx`
- `src/services/recognize/simple_latex/index.jsx`
- `src/services/recognize/system/index.jsx`
- `src/services/recognize/tencent_accurate/Config.jsx`
- `src/services/recognize/tencent_accurate/index.jsx`
- `src/services/recognize/tencent_img/Config.jsx`
- `src/services/recognize/tencent_img/index.jsx`
- `src/services/recognize/tencent/Config.jsx`
- `src/services/recognize/tencent/index.jsx`
- `src/services/recognize/volcengine_multi_lang/Config.jsx`
- `src/services/recognize/volcengine_multi_lang/index.jsx`
- `src/services/recognize/volcengine/Config.jsx`
- `src/services/recognize/volcengine/index.jsx`
- `src/services/translate/alibaba/Config.jsx`
- `src/services/translate/alibaba/index.jsx`
- `src/services/translate/baidu_field/Config.jsx`
- `src/services/translate/baidu_field/index.jsx`
- `src/services/translate/baidu/Config.jsx`
- `src/services/translate/baidu/index.jsx`
- `src/services/translate/bing_dict/index.jsx`
- `src/services/translate/bing/index.jsx`
- `src/services/translate/caiyun/Config.jsx`
- `src/services/translate/caiyun/index.jsx`
- `src/services/translate/cambridge_dict/index.jsx`
- `src/services/translate/chatglm/Config.jsx`
- `src/services/translate/chatglm/index.jsx`
- `src/services/translate/deepl/Config.jsx`
- `src/services/translate/deepl/index.jsx`
- `src/services/translate/ecdict/index.jsx`
- `src/services/translate/geminipro/Config.jsx`
- `src/services/translate/geminipro/index.jsx`
- `src/services/translate/google/index.jsx`
- `src/services/translate/lingva/index.jsx`
- `src/services/translate/niutrans/Config.jsx`
- `src/services/translate/niutrans/index.jsx`
- `src/services/translate/ollama/Config.jsx`
- `src/services/translate/ollama/index.jsx`
- `src/services/translate/openai/Config.jsx`
- `src/services/translate/openai/index.jsx`
- `src/services/translate/tencent/Config.jsx`
- `src/services/translate/tencent/index.jsx`
- `src/services/translate/transmart/Config.jsx`
- `src/services/translate/transmart/index.jsx`
- `src/services/translate/volcengine/Config.jsx`
- `src/services/translate/volcengine/index.jsx`
- `src/services/translate/yandex/index.jsx`
- `src/services/translate/youdao/Config.jsx`
- `src/services/translate/youdao/index.jsx`
- `src/services/tts/edge_tts/index.jsx`
- `src/services/tts/lingva/Config.jsx`
- `src/services/tts/lingva/index.jsx`
- `src/utils/env.js`
- `src/utils/http.js`
- `src/utils/invoke_plugin.js`
- `src/utils/lang_detect.js`
- `src/utils/store.js`
- `src/utils/window_size.js`
- `src/window/Config/index.jsx`
- `src/window/Config/pages/About/index.jsx`
- `src/window/Config/pages/Backup/index.jsx`
- `src/window/Config/pages/Backup/utils/aliyun.jsx`
- `src/window/Config/pages/Backup/utils/local.jsx`
- `src/window/Config/pages/Backup/utils/webdav.jsx`
- `src/window/Config/pages/General/index.jsx`
- `src/window/Config/pages/History/index.jsx`
- `src/window/Config/pages/Hotkey/index.jsx`
- `src/window/Config/pages/Service/index.jsx`
- `src/window/Config/pages/Service/PluginConfig/index.jsx`
- `src/window/Config/pages/Service/SelectPluginModal/index.jsx`
- `src/window/Config/pages/Translate/index.jsx`
- `src/window/Recognize/ControlArea/index.jsx`
- `src/window/Recognize/ImageArea/index.jsx`
- `src/window/Recognize/index.jsx`
- `src/window/Recognize/TextArea/index.jsx`
- `src/window/Screenshot/index.jsx`
- `src/window/Translate/components/SourceArea/index.jsx`
- `src/window/Translate/components/TargetArea/index.jsx`
- `src/window/Translate/index.jsx`
- `src/window/Updater/index.jsx`
- `vite.config.js`
