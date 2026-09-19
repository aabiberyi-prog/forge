# Forge repair candidate

This is the packaging identity for the 2026-09-19 selected-scope repair stack. It is **not** authorization to tag, publish, or install over `D:\Pot Forge`.

## Identity

| Field | Value |
|---|---|
| Product | Pot Forge 3.0.8 |
| Identifier | `com.aabiber.pot-forge` |
| Isolated test id | `com.aabiber.forge-migration-check` |
| Stack | `repair/phase-1-data` → `phase-2-todo` → `phase-3-capture` → `phase-4-scroll-pins` → `phase-5-reliability` → `repair/phase-6-accept` |
| Source candidate | `db7926625935a85ae0805823011ac03eaa690180` on `repair/phase-6-accept` |
| Unsigned NSIS (this SHA) | `C:\cargo-target\forge-repair-p6\x86_64-pc-windows-msvc\release\bundle\nsis\Pot Forge_3.0.8_x64-setup.exe` |
| Setup SHA256 | `B18AC348D615A08A5B3147558C9E248F7E261270274CCFCA5987097DF1F6FBF6` (36,702,800 bytes) |
| Isolated install | `%TEMP%\Forge-candidate-db7926625` (NSIS `/S` exit 0) |
| Isolated exe SHA256 | `81EF17EB65EE9D29F42EB8805327741596E0C76722C89B44089C0BFD62581C3A` (64,788,480 bytes; Tauri patches the NSIS payload) |
| Signed updater of this SHA | **not produced** (public key present, `TAURI_SIGNING_PRIVATE_KEY` unset) |

Do not treat the previously installed 3.0.8 at `D:\Pot Forge` (`8ccd8f845`, exe SHA256 `6D974AAE…38856BF3`) as this candidate. That live exe hash was unchanged after the isolated TEMP install.

## Recount 2026-09-19 (read-only, after isolated install)

| Store | Result |
|---|---|
| Desktop ToDo | 86 tasks, 69 history, 9 clips, 8 images, 0 missing files |
| Live Forge `history.db` | SHA256 `c9ea4e7a…f27245`; tasks 0, clips 1, clip_images 0, translate history 0, capture_history 1; no `import_ledger` |
| Official Pot config | SHA256 `5f533eba…cadd99d` (unchanged) |
| Live Forge config | SHA256 `f35d1c27…552c3d` |

The candidate was **not** launched (same identifier would hit the live single-instance mutex and live profile).

## Isolated verify (when an NSIS of this SHA exists)

1. Do **not** use `D:\Pot Forge` or `%APPDATA%\com.aabiber.pot-forge`.
2. Install per-machine to a disposable directory, e.g. `%TEMP%\Forge-candidate`.
3. Set `FORGE_BACKUP_PROFILE_DIR` to a temp folder; keep official Pot and Desktop ToDo hashes unchanged.
4. Run unit tests already in CI, then desktop cases in `docs/ACCEPTANCE.json` layer `desktop`.
5. Rollback: uninstall the candidate, restore the previous installer if needed, confirm the isolated profile zip still extracts.

Signing uses `TAURI_SIGNING_PRIVATE_KEY` (Tauri 2). Do not run `windows-release.yml` publish steps without a separate tag/release yes.

## Real profile

Recount Desktop ToDo (86/69/9/8) and live Forge DB immediately before any approved import. Preview merge first. Do not import or replace the installed app until the user says yes.
