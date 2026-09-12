# Phase 0 execution record

Date: 2026-09-12
Plan: [MERGE-PLAN.md](MERGE-PLAN.md)
Branch: `phase-0/foundation`
Base: `38212f95acb8ca132f634eb31d3e85dade073af4` (`docs/merge-plan`)
Status: implemented and verified locally; user approved both commits and push.
Phase 1 has not started.

## Changes

| Files | Change |
|---|---|
| `NOTICE` | Credit pot-app and Forge contributors; preserve GPL-3.0-only and existing notices. |
| `src-tauri/tauri.conf.json` | Replace upstream updater URLs with the Forge `update.json` URL and install the new public key. |
| `src-tauri/webview.x64.json`, `webview.x86.json`, `webview.arm64.json` | Replace upstream updater URLs with the Forge `update-fix-runtime.json` URL and use the same new public key. |
| `updater/updater.mjs`, `updater/updater-for-fix-runtime.mjs` | Fetch release metadata, signatures, and bundles from `aabiberyi-prog/forge`; remove the Pot download proxy. |
| `.gitignore` | Exclude signing secrets, local environment files, and generated manifests. Public keys and `.env.example` remain trackable. |
| `docs/MERGE-PLAN.md`, `docs/PHASE-0-FOUNDATION.md` | Record completed Phase 0 work, evidence, and the next gate. |

The product name remains `Pot Forge`, the identifier remains
`com.aabiber.pot-forge`, and the application version remains `3.0.8`.

The history check found that `661395d` changed the branding and identifier
but left the updater configuration unchanged. The starting worktree was clean.
Only Phase 0 files were changed; the QuickTask donor was read as a reference.

## Signing key custody

Generated with the installed Tauri CLI 1.6.3, following the
[official Tauri v1 updater guide](https://v1.tauri.app/v1/guides/distribution/updater/).
The new signing key is separate from Pot's upstream key.

- Private key: `%LOCALAPPDATA%\Forge\Signing\updater.key.clixml`, a
  Windows DPAPI CurrentUser-encrypted `SecureString`.
- Public key: `%LOCALAPPDATA%\Forge\Signing\updater.key.pub`; also embedded
  in the four updater configurations.
- The signing directory has inheritance disabled and access limited to
  the current Windows user and SYSTEM.
- No plaintext private-key file was created. Generation output was captured
  privately, and the signing check passed the key through a pipe to the
  in-process Tauri CLI binding, not a command-line argument.
- Decryption/readback was verified in a fresh process. DPAPI custody depends
  on this Windows user and machine; the encrypted file alone is not a
  portable backup. Arrange secure recovery and CI secret provisioning before
  publishing the first release. GitHub secrets were not changed.

SHA-256 of the decoded public-key file:
`d5b0b6aaf825ec7caf529f08460a4c16eddff789434b3278f44027e35c47a581`.

Tauri 1 signing uses `TAURI_PRIVATE_KEY` and `TAURI_KEY_PASSWORD`. The
generated key uses an empty minisign password inside the DPAPI envelope;
the protection at rest is Windows DPAPI and the directory ACL. During a
local release build, decrypt only into the build process environment and
restore/clear that environment afterward. Revisit the variable names during
the Phase 1 migration to Tauri 2.

## Verification

| Check | Coverage / result |
|---|---|
| Tauri configuration | All 7 JSON configurations parsed and merged: base, Windows, Linux, macOS, and the 3 fixed-runtime variants. All use exactly one Forge endpoint and the same public key. Product name and identifier preserved. |
| Explicit updater keys | 4/4 matched the generated public key; decoded minisign public-key structure validated. |
| Signing | Fresh payload signed by the Tauri CLI after decrypting the saved key. Independent `minisign-verify` 0.2.5 accepted the signature, rejected an altered payload, and rejected that signature under Pot's old public key: 3/3 checks passed. |
| Manifest routing | Both existing generators executed with local HTTP/file fixtures: 13/13 outbound requests and 12/12 emitted platform URLs target Forge over HTTPS. No network writes or release publication. |
| Toolchain | `tauri info` completed; Windows MSVC and WebView2 detected. The NAS checkout has no installed frontend dependencies. The existing local Pot Forge CLI was used for key generation and inspection. |
| Whitespace | `git diff --check` passed. |
| Secret exclusions | All 7 tested secret/generated-file paths ignored; public key and example environment file not ignored. |

The signing and routing verification harnesses are outside Git at
`%TEMP%\forge-phase0-01a093e3`. The verifier was built offline with
`CARGO_TARGET_DIR=C:\cargo-target\forge\phase0-verifier`.

This verifies update routing and signing trust, not release readiness. No
full frontend/Rust application build, installer, live update installation,
or Phase 1 feature acceptance test was run. The
[Forge releases page](https://github.com/aabiberyi-prog/forge/releases)
showed no published releases when checked on 2026-09-12; the new manifest
URLs cannot deliver an update until release assets are published.

## Deferred release work and next gate

Phase 7 owns the inherited release pipeline. Before publishing, reconcile:

1. Hard-coded `pot_...` artifact names and rename steps with the actual
   Forge build outputs.
2. The 3 unsupported Linux platform entries currently pointing at a macOS
   ARM bundle in the normal manifest generator.
3. Generator failure handling: missing releases/signatures must fail the
   release job rather than emit empty signatures or undefined versions.
4. Upstream documentation dispatch, Homebrew, and WinGet publication jobs
   retained in `.github/workflows/package.yml`.
5. CI signing secrets and a portable secure backup of the Forge key.

These items were identified, not executed or repaired in Phase 0. Do not
publish based solely on the routing fixture results above.

Approved commit grouping:

1. `docs: credit pot-app contributors` — `NOTICE`.
2. `fix(updater): isolate Forge update trust and endpoints` — the remaining
   9 files in the changes table, including this record and the plan status.

The initial implementation ended without commits or pushes. The user then
selected "Commit and push" on 2026-09-12 for these two commits. The approved
remote is `origin` (`https://github.com/aabiberyi-prog/forge.git`), targeting
`origin/phase-0/foundation`. Git history and the remote branch record the
execution result. This approval does not authorize a PR, merge, tag, or release.

After the Phase 0 Git decision, continue on `phase-1/tauri2-migration` from
the approved foundation. Phase 1 must pass all 9 listed live feature checks
before Phase 2 begins. Re-estimate Phase 1 on 2026-09-19 and apply the plan's
four-week stop criterion if the migration remains unresolved.
