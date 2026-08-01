# Implementation status

Last updated: `2026-08-01`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The retired fixed-32-ledger recovery halted on a content-dependent Worker subrequest limit. The successor chain is absent, terminal lag was `56,740`, Worker Cron is empty, and no stabilization qualification or 24-hour soak is active.

The public read surface remains a production test surface backed by the last verified immutable base plus committed legacy live data. Mainnet remains disabled. The portable runtime, reader, mappers, shadow comparator, publication adapter, and maintenance adapter are not connected to a hosted deployment or public route.

## Controlling documents

- Recovery design and schedule: [`ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md`](ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md)
- R3 adapter and reader plan: [`ops/r3-adapter-reader-integration-plan-2026-08-01.md`](ops/r3-adapter-reader-integration-plan-2026-08-01.md)
- R3A evidence: [`ops/r3a-adapter-conformance-evidence-2026-08-01.md`](ops/r3a-adapter-conformance-evidence-2026-08-01.md)
- R3B evidence: [`ops/r3b-committed-reader-evidence-2026-08-01.md`](ops/r3b-committed-reader-evidence-2026-08-01.md)
- R3C evidence: [`ops/r3c-product-mapper-shadow-evidence-2026-08-01.md`](ops/r3c-product-mapper-shadow-evidence-2026-08-01.md)
- R3D evidence: [`ops/r3d-publication-maintenance-evidence-2026-08-01.md`](ops/r3d-publication-maintenance-evidence-2026-08-01.md)
- Parent R2 contract: [`ops/r2-portable-runtime-contract-2026-08-01.md`](ops/r2-portable-runtime-contract-2026-08-01.md)
- Runtime invariants: [`history-runtime-contract.md`](history-runtime-contract.md)
- Resource gates: [`resource-envelope.md`](resource-envelope.md)

## Production evidence

Controlling checkpoint: Issue #1079.

- network: `devnet`
- Mainnet enabled: `false`
- Worker Cron: empty
- last completed slot: `2026-08-01T03:52:00Z`
- failed slot: `2026-08-01T03:53:00Z`
- failure: `Too many subrequests by single Worker invocation`
- last processed ledger: `4,051,454`
- latest observed ledger: `4,108,194`
- terminal lag: `56,740`
- successor chain: halted
- 24-hour soak: not started

The halted remote deployment is evidence and rollback context only. It is not an operating collector.

## Completed reconstruction milestones

- R0 contract and portability reset: PR #1081, merge `c077e7b16b8b08213bbadcc5e927bba0f9472f6c`.
- R1 reference schema and deterministic planner: PR #1082, merge `85f42e665a5e6f2f519cd372718b9c41c16b3f68`.
- R2 typed durable runtime and parent exit: PRs #1084–#1095, final merge `fb90cbbd3a44337dc0891552f3618581cfc31e1c`.
- R3 adapter and reader contract: PR #1096, merge `d38615dc283462dee50605adb535caefb1975f0f`.
- R3A adapter interfaces and SQLite conformance: PR #1097, merge `741f4ac24396dd21ae100b963ea439782b1696be`.
- R3B committed generic reader: PR #1098, merge `fa04ea280525e7c93bf13dd1b8debbfcf78193af`.
- R3C product mappers and shadow compatibility: PR #1099, merge `e7bcedcf3f597e765da42098a89683e1ba62cd68`.

## R2 completion

R2 and R2b2 are complete on `main`. The retained suites prove sparse and dense durable phase chains, all seven semantic classes, complete identity, no early visibility, exact retry and lease behavior, staged/committing/committed runtime-version-3 restore, terminal gates, and provider-neutral imports.

## Active R3 work

### R3A — Adapter interfaces and SQLite conformance

Status: **complete on `main`** in PR #1097, merge `741f4ac24396dd21ae100b963ea439782b1696be`.

### R3B — Committed generic reader

Status: **complete on `main`** in PR #1098, merge `fa04ea280525e7c93bf13dd1b8debbfcf78193af`.

### R3C — Product mappers and shadow compatibility

Status: **complete on `main`** in PR #1099, merge `e7bcedcf3f597e765da42098a89683e1ba62cd68`.

Delivered seven strict portable product mappers, complete provenance, `legacy_only` and `shadow_compare` modes, deterministic bounded comparison evidence, and no public authority change.

### R3D — Publication and maintenance separation

Status: **implementation and validation passed in PR #1100; merge pending**.

Delivered on the branch:

- migration `10007_portable_publication_maintenance.sql`;
- independent durable publication candidates, ordered work membership, publication watermarks, maintenance plans, and maintenance mutations;
- committed-only contiguous publication selection for one network, epoch, base, and stream;
- canonical immutable assets containing complete work identities and committed reference rows;
- SHA-256 asset, manifest, publication, and maintenance-plan identities;
- candidate persistence without publication-watermark movement;
- independent candidate reopen, asset rebuild, and digest verification;
- verified-only publication-watermark advancement;
- unchanged collection watermark throughout publication and maintenance;
- publication chaining from the stored publication watermark;
- bounded oldest-first payload and commit chunk compaction after independently verified publication only;
- retention of work, committed reference rows, collection watermark, publication candidate, and publication watermark;
- idempotent candidate creation, watermark advancement, and maintenance replay;
- tamper, stale-watermark, changed-identity, and unverified-publication rejection.

Latest validated head: `199497d73774fd739f37c65e4771b5a4ad9b460a`.

CI run `30701236573` passed:

- workflow-surface guard;
- lint;
- D1 headroom and live-cutover shell syntax checks;
- canonical production base identity validation;
- TypeScript type-check;
- production runner bundle and configuration validation;
- complete unit-test suite;
- complete clean local migration sequence, including migration `10007`;
- application build;
- browser smoke.

R3D is recorded complete only after PR #1100 merges to `main`.

### R3E — Cross-adapter export, restore, and parent R3 exit

Status: **next after PR #1100 merges**.

Required work:

- canonical complete-state export including collection, scheduler, publication, and maintenance state;
- empty-target restore through adapter boundaries;
- exact state parity after restore;
- committed reader fence and query parity after restore;
- source-bound cursor rejection or deterministic continuation according to the restored fence contract;
- publication candidate, verified status, publication watermark, maintenance plan, and applied-mutation parity;
- staged, committing, committed, published, and maintained state transfer cases;
- complete parent R3 conformance suite;
- no hosted provider selection or production mutation.

R3 remains local and provider-neutral. It does not select Cloudflare or another hosted profile and does not mutate production.

## Later gates

### R4 — Deployment-profile qualification

No hosted profile is selected before conformance and shadow evidence. Mandatory paid dependencies, automatic paid overage, inadequate export, or routine interactive operation are rejection conditions.

### R5 — Controlled recovery

Deploy only a qualified profile and prove staged work, rollback, restore, and a fixed two-hour catch-up qualification.

### R6 — Lag-zero and steady qualification

Reach lag zero, pass twelve consecutive five-minute freshness checkpoints, and remain inside the measured no-cost envelope.

### R7 — Formal operation evidence

Pass fixed 24-hour and seven-day evidence windows before reopening formal Devnet release qualification.

## Operating restrictions

- Do not describe the collector as operating while its successor or lease chain is absent.
- Do not restart the retired fixed-32-ledger runtime.
- Do not select a hosted provider before R4 qualification.
- Do not use GitHub Actions as the normal collection clock.
- Do not start stabilization or soak before R6.
- Do not enable Mainnet.
- Do not remove semantic history classes or public product capabilities.
- Do not skip a failed ledger or advance a cursor after partial persistence.
- Do not mix portable and legacy reader sources inside one response.
- Do not silently fall back after integrity or identity failure.
- Do not expose the portable reader through public routes before an explicit cutover gate.
- Do not implement portable-primary or portable-only mode during R3.
- Do not make a provider dashboard, local terminal, or paid runtime dependency part of routine recovery.
- Do not call a theoretical no-cost projection an operating result.
