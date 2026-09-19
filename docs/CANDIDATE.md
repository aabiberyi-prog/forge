# Forge repair candidate

This is the packaging identity for the 2026-09-19 selected-scope repair stack. It is **not** authorization to tag, publish, or install over `D:\Pot Forge`.

## Identity

| Field | Value |
|---|---|
| Product | Pot Forge 3.0.8 |
| Identifier | `com.aabiber.pot-forge` |
| Isolated test id | `com.aabiber.forge-migration-check` |
| Stack | `repair/phase-1-data` → `phase-2-todo` → `phase-3-capture` → `phase-4-scroll-pins` → `phase-5-reliability` → `repair/phase-6-accept` |
| Source candidate | git tip of `repair/phase-6-accept` (`git rev-parse HEAD`) |
| Signed NSIS of this SHA | **not built** |

Print the SHA at verify time with `git rev-parse HEAD`. Do not treat the previously installed 3.0.8 at `D:\Pot Forge` (`8ccd8f845`) as this candidate.

## Isolated verify (when an NSIS of this SHA exists)

1. Do **not** use `D:\Pot Forge` or `%APPDATA%\com.aabiber.pot-forge`.
2. Install per-machine to a disposable directory, e.g. `%TEMP%\Forge-candidate`.
3. Set `FORGE_BACKUP_PROFILE_DIR` to a temp folder; keep official Pot and Desktop ToDo hashes unchanged.
4. Run unit tests already in CI, then desktop cases in `docs/ACCEPTANCE.json` layer `desktop`.
5. Rollback: uninstall the candidate, restore the previous installer if needed, confirm the isolated profile zip still extracts.

Signing uses `TAURI_SIGNING_PRIVATE_KEY` (Tauri 2). Do not run `windows-release.yml` publish steps without a separate tag/release yes.

## Real profile

Recount Desktop ToDo (86/69/9/8) and live Forge DB immediately before any approved import. Preview merge first. Do not import or replace the installed app until the user says yes.
