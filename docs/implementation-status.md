# Implementation status

Last updated: 2026-09-20

## Current decision

XRPL Lending Monitor is pivoting to a DB-less static-artifact runtime.

The prior Cloudflare D1 / Queue / Worker-scheduled collector and Supabase recovery architecture is retired as a future direction. It must not be restarted merely to continue the old recovery chain.

The repository still contains substantial legacy runtime code. Therefore the architecture decision is **adopted**, but the DB-less production implementation is **not yet complete**.

## Canonical main at decision time

`fc6e9f2b8d967b6923c5d8529378c21cb172a08e`

Commit title:

`Remove retired Current control-plane workflows (#1660)`

At this commit, `wrangler.jsonc` still declares a D1 database, minute Cron, and legacy Worker runtime. Those bindings describe legacy code that D6 will remove; they do not override the new source-of-truth documents.

## Proven reusable evidence

### Fresh complete Current build

A 2026-09-11 GitHub Actions run successfully built a complete type-filtered binary Current snapshot.

Evidence:

- Actions run: `34563293802`;
- validated ledger: `5,218,039`;
- ledger hash: `5701853F89034B14F4E9698AD31E04535636CF4DD9CD986136ABDA7F290011A6`;
- Vaults: `1,234,169`;
- LoanBrokers: `776,954`;
- Loans: `339,744`;
- total relevant objects: `2,350,867`;
- read-model page size: `50`;
- read-model lookup prefix length: `2`.

This proves complete DB-independent source acquisition and static read-model generation are feasible. It does not prove the new live runtime.

### Existing historical archive

The retained `history-data` publication proves:

- epoch: `devnet-3371675`;
- start ledger: `3,371,676`;
- end ledger: `3,932,301`;
- ledgers: `560,626`;
- segments: `1,136`;
- exact index records: `33,811,930`.

The archive is retained as historical evidence.

No continuity is claimed from `3,932,302` to the future DB-less live-history start until backfill is independently verified.

## Reusable code

High-value reuse candidates already exist for:

- validated ledger parsing;
- WebSocket ledger reading;
- Lending transaction filtering;
- AffectedNodes normalization;
- Current overlay mutation derivation;
- Loan lifecycle derivation;
- deleted-object archive derivation;
- cover/debt/loss history derivation;
- history segment record building;
- Vault/LoanBroker/Loan normalization;
- existing React presentation routes/components.

## Retired problem area

Do not spend new implementation time repairing:

- D1 capacity behavior;
- Queue delivery/cadence;
- fast-lane D1 persistence;
- Supabase R4/R5 recovery;
- Worker Cron cutover/reseed;
- D1 overlay fold/cutover.

These are historical implementation paths.

## Active roadmap unit

**D0 — Source-of-truth reset: complete**

Merged through PR #1661 as `f764967947f0be10f08013ac8a655cef3bc816f6`.

**D1 — Persistence decoupling: complete**

Merged through PR #1663 as `09b9fae2eeeec54f3dbc82101e16704b41fe0b80`.

Validation run `35457202156` passed typecheck, focused lint, and the DB-less fixture suite. The merged contracts now provide deterministic seven-class Current+History live artifacts, immutable artifact publication interfaces, channel integrity/coverage rules, and collector-layer overlay typing without a Worker repository dependency.

**D2 — Current base generation: active**

The canonical type-filtered binary traversal, Release-compatible base read model, independent verifier, and candidate publication workflow are implemented on main.

The first marker-exhaustive production-shaped candidate, Actions run `35481956144`, proved the full source/build path at validated ledger `5,450,831`:

- ledger hash: `C521EEB008ECB856988EBC0F584D746E7D559959AC8711F680FDC0E165BDCD13`;
- Vaults: `1,297,202`;
- LoanBrokers: `805,523`;
- Loans: `352,870`;
- total Current objects: `2,455,595`;
- Release assets: `858`;
- compressed bytes: `859,629,453`;
- largest asset: `1,887,208` bytes;
- base manifest SHA-256: `7bf42041f02b8955b59e9c9f0c4c163ddf4f4e48c61351d1f1847483d789a31d`.

That run passed complete marker exhaustion, Release-compatible base generation, the independent verifier, and the Release asset ceiling. It failed only during high-rate Release upload when GitHub returned HTTP 403 secondary rate limiting at `lookup-E4.json.gz`. No prerelease was published.

PR #1681 replaced burst uploads with one-at-a-time upload, pacing, bounded retry/backoff, uncertain-upload recovery, and final GitHub-provided SHA-256 digest verification. It merged as `560ddcc8cee38a2eb07de0f27fef8052e208296e`.

Fresh retry run `35515051078` is the active D2 exit run. D2 is not complete until that run or a successor completes remote upload, name/size/SHA-256 readback, and prerelease publication.

**D3 — Live collector and publication: implementation prepared, activation gated on D2**

Draft PR #1679 contains the DB-less live collector path. Its current design separates:

- one small mutable control Release that contains the authoritative channel;
- immutable data Releases that hold live delta/chunk/chain artifacts;
- per-delta artifact locations so one live chain can span multiple data Releases.

The branch also contains:

- verified initial-channel generation from the D2 base plus pinned legacy History publication/exact index;
- bounded validated-ledger catch-up;
- one-scan Current + History derivation;
- channel-last publication;
- immutable artifact readback verification;
- owner-gated read-only rehearsal;
- owner-gated candidate initialization;
- owner-gated one-shot live publication;
- one non-cancelling single-writer concurrency group.

The five-minute schedule is intentionally not enabled yet. Candidate one-shot publication must pass first.

Bounded Release sharding is now implemented in the D3 draft: live data uses deterministic six-hour UTC shard tags, a 720-asset soft ceiling below GitHub's 1,000-asset Release ceiling, and `-rN` early rotation when the projected artifact count would exceed the configured shard limit. Shard selection happens only after delta artifact count is known, so heavy catch-up runs do not rely on a guessed per-run asset count. The rule is implemented but not yet activation evidence; it must pass rehearsal/one-shot verification before scheduling.

Latest validation for the Release-spanning design is required to remain green before #1679 leaves draft.

## Release status

Not formally released.

The next release requires completion of D1-D8 in `development-roadmap.md`, with evidence recorded as each unit exits.