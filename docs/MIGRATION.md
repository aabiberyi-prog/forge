# Migrating to Forge Windows 1.0

Forge is a Tauri 2 desktop app that replaces **Pot**, **ShareX's five hotkeys**,
and **Desktop ToDo / QuickTask** on this PC. Identifier
`com.aabiber.pot-forge` is unchanged, so an existing pot-forge profile keeps
working.

## Install

1. Uninstall is optional. The NSIS installer (`Pot Forge_*_x64-setup.exe`)
   from [GitHub Releases](https://github.com/aabiberyi-prog/forge/releases)
   can sit beside the old `D:\Pot Forge` install until you are happy.
2. WebView2 is bootstrapped by the installer if missing.
3. After install, open **Config → Backup**.

## From official Pot (`com.pot-app.desktop`)

Use **Config → Backup → Import from official Pot**. That copies settings into
the Forge store. API keys are moved to the OS keychain on next launch if the
keychain write can be read back; otherwise they stay in JSON.

## From pot-forge

No import is required when you keep `com.aabiber.pot-forge`. Translate history
is `history.db` in that folder. Tasks and clips are tables in the same file.

## From Desktop ToDo / QuickTask (`com.local.desktop-todo`)

Use **Config → Backup → Import from Desktop ToDo**. Tasks and clips (plus
`copy-assets`) are copied into Forge SQLite. Then you can stop using
QuickTask.

## From ShareX

Forge takes over only the five hotkeys that were actually in use:

| Hotkey | Forge action |
|---|---|
| Alt+1 | Region capture + annotation, then copy and save |
| Alt+2 | Scrolling capture (Windows) |
| Alt+3 | Pin to screen |
| Alt+4 | Screen recording (ffmpeg) |
| Alt+5 | OCR recognise |

Disable those bindings in ShareX so they do not fight Forge. Screenshots and
recordings still default to `D:\ShareX\Screenshots`. ffmpeg is fetched on
first record if it is not already on `PATH`.

## Updater

The app checks
`https://github.com/aabiberyi-prog/forge/releases/download/updater/update.json`
using the Forge minisign public key. It will not accept Pot upstream updates.

## What is not migrated

- ShareX uploaders, watch folders, and the rest of the 25-tool suite
- iOS keyboard sync
- macOS (Phase 8)
