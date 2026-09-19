# Acceptance accounting

Machine-readable ledger: [ACCEPTANCE.json](ACCEPTANCE.json). Candidate identity: [CANDIDATE.md](CANDIDATE.md).

| Bucket | Rule |
|---|---|
| `pass` | Verified by an automated test named in `evidence` |
| `blocked` | Required but not run on a signed NSIS of this SHA, or needs credentials |
| `skip` | Out of scope (OS01, unselected ShareX groups) |

`skip` and `blocked` are never counted as `pass`. Required `unit` cases must all be `pass`. Required `desktop` cases stay `blocked` until an isolated NSIS of `git rev-parse HEAD` is installed somewhere other than `D:\Pot Forge`.

Do not tag, publish, import the live profile, or replace the installed app without a separate yes.
