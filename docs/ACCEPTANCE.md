# Acceptance accounting

Case contract: [ACCEPTANCE.json](ACCEPTANCE.json). Safe candidate identity: [CANDIDATE.md](CANDIDATE.md).

| Bucket | Rule |
|---|---|
| `pending` | Automated case has no execution result yet |
| `pass` | Every referenced check actually ran and passed |
| `fail` | A referenced check failed |
| `not_run` | Evidence was missing or a referenced test was skipped |
| `blocked` | Required but not run on a signed NSIS of this SHA, or needs credentials |
| `skip` | Out of scope (OS01, unselected ShareX groups) |

The contract is not an execution report. Run `pnpm verify` for local non-destructive verification; it uses temporary test data and excludes credential writes and live imports. `pnpm verify:ci --out verification.json` additionally runs the isolated credential test on the disposable CI runner. The 86-task import case generates a deterministic fixture instead of depending on a user's dataset.

The generated report derives statuses from Node/Rust results and records Git HEAD, dirty state, and a fingerprint of application/build inputs. Provider prerequisites are separate from executed evidence. Missing, skipped, and blocked checks never count as passes.

Publication additionally requires passed native cases bound to the actual candidate artifact checksum. The release gate rejects source mismatch, dirty source, incomplete cases, missing candidate identity, and artifact mismatch. Merely installing to another directory does not isolate a production-identifier application.

Do not tag, publish, import the live profile, or replace the installed app without a separate yes.
