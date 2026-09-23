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

**D2 — Current base generation: complete**

The canonical type-filtered binary traversal, Release-compatible base read model, independent verifier, and candidate publication workflow are implemented on main.

The first production-shaped candidate, Actions run `35481956144`, proved the full source/build path but failed during high-rate Release upload because GitHub returned HTTP 403 secondary rate limiting. PR #1681 added one-at-a-time upload, pacing, bounded retry/backoff, uncertain-upload recovery, and GitHub-provided SHA-256 verification.

Run `35515051078` then passed snapshot generation, base generation, independent verification, and the asset ceiling, but exposed a separate draft-Release lookup bug before the first upload. PR #1683 fixed draft Release handling by carrying the exact Release ID through upload/verify/publish and using the tag endpoint only after publication. It merged as `f2d4da7009f3b3a34bae5c846d4558b752b0b9fe`.

The D2 exit run `35558034659` completed successfully:

- source revision: `f2d4da7009f3b3a34bae5c846d4558b752b0b9fe`;
- validated ledger: `5,479,808`;
- ledger hash: `7A7D48431A7B36490C226D4D9731F7C3AB825F108321FF974ACF29ABB856D59C`;
- Vaults: `1,301,400`;
- LoanBrokers: `807,256`;
- Loans: `353,698`;
- Release assets: `860`;
- compressed bytes: `861,955,138`;
- largest asset: `1,886,419` bytes;
- source manifest SHA-256: `cfe4c70ff1ef2da6c30c397a5f5819247bf2182ffe45cefa975696767b88cc70`;
- base manifest SHA-256: `89d9346d4eb2403b80ffc53b81b1a7621d8467506b3b931bfc9f688e6b5a4dc3`.

Every D2 publication step passed: draft Release creation/recovery, throttled upload, exact remote name/size/SHA-256 verification, prerelease publication, and compact evidence upload. Release `d2-current-base-35558034659` exists as `draft=false`, `prerelease=true`, with all `860` assets remotely present.

**D3 — Live collector and publication: complete**

The DB-less live collector and publication chain are implemented on main. The design separates:

- one small mutable control Release that contains the authoritative channel;
- immutable data Releases that hold live delta/chunk/chain artifacts;
- per-delta artifact locations so one live chain can span multiple data Releases.

Implemented and production-shaped evidence now includes:

- D3 rehearsal run `35594182270`: PASS;
- candidate initialization run `35594237813`: PASS;
- repeated bounded one-shot and activation catch-up publications with channel-last control updates;
- adaptive catch-up width bounded by the 720-asset Release ceiling;
- denser manual catch-up chunks while retaining the 512,000-byte chunk ceiling;
- one-at-a-time GitHub Release upload pacing, bounded retry/backoff, and exact remote SHA-256 recovery;
- canonical-byte control Release enforcement;
- bounded head + immediate-predecessor verification for normal operation;
- full cross-Release linked-chain reconstruction for qualification;
- live-head freshness fallback with a 30-second maximum validated-ledger age;
- one non-cancelling single-writer concurrency group on the actual mutation job;
- formal qualification run `35809460180`: PASS, with active shard bounds, full linked-chain verification, and the <=256-ledger catch-up-to-latest gate all passing;
- post-activation qualification run `35822742381`: PASS.

Five-minute activation is also merged:

- #1682 enabled the five-minute schedule;
- #1692 moved cron delivery into a dedicated driver that dispatches the existing bounded collector;
- #1693 staggered the cron to `2-59/5 * * * *` to avoid the common top-of-hour boundary;
- #1694 added an owner-only diagnostic trigger for the exact driver logic;
- diagnostic driver run `35822507664`: PASS;
- dispatched collector run `35822514298`: PASS.

The final D3 exit proof is now complete:

- genuine schedule driver run `35847201599` ran with `event=schedule` and passed;
- that driver dispatched bounded collector run `35847211102`, which passed every collection, publication, readback, channel-update, linked-chain verification, and evidence step;
- the successful scheduled collector advanced the candidate control head to ledger `5,534,676`, hash `178264A1B34857E9DDAD07C4FEDD73247487FF2A0B812B48EC57F9C6EEEB0579`;
- resulting channel SHA-256: `5124bc0e69cb235887fc5a477987e904f9417be724132a4ac3511a29fa727164`.

Bounded Release sharding uses deterministic six-hour UTC shard tags, a 720-asset operational ceiling below GitHub's 1,000-asset Release ceiling, and `-rN` early rotation when projected artifact count would exceed the shard limit.

**D4 — Compaction and bounded indexes: active**

D4 now owns the next implementation gate: compact live Current mutations into bounded overlay/index shards, define retention for superseded live artifacts, prove bounded exact/list query plans, and prevent project-age-driven five-minute delta fan-out.

## Release status

Not formally released.

The next release requires completion of D1-D8 in `development-roadmap.md`, with evidence recorded as each unit exits.