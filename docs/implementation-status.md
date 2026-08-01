# Implementation status

Last updated: `2026-08-01`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The retired fixed-32-ledger recovery halted on a content-dependent Worker subrequest limit. The successor chain is absent, terminal lag was `56,740`, Worker Cron is empty, and no stabilization qualification or 24-hour soak is active.

The public read surface remains a production test surface backed by the last verified immutable base plus committed legacy live data. Mainnet remains disabled. The portable runtime and reader are not connected to a hosted deployment or public route.

## Controlling documents

- Recovery design and schedule: [`ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md`](ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md)
- R3 adapter and reader plan: [`ops/r3-adapter-reader-integration-plan-2026-08-01.md`](ops/r3-adapter-reader-integration-plan-2026-08-01.md)
- R3A evidence: [`ops/r3a-adapter-conformance-evidence-2026-08-01.md`](ops/r3a-adapter-conformance-evidence-2026-08-01.md)
- R3B evidence: [`ops/r3b-committed-reader-evidence-2026-08-01.md`](ops/r3b-committed-reader-evidence-2026-08-01.md)
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

## R2 completion

R2 and R2b2 are complete on `main`. The retained suites prove sparse and dense durable phase chains, all seven semantic classes, complete identity, no early visibility, exact retry and lease behavior, staged/committing/committed runtime-version-3 restore, terminal gates, and provider-neutral imports.

## Active R3 work

### R3A — Adapter interfaces and SQLite conformance

Status: **complete on `main`** in PR #1097, merge `741f4ac24396dd21ae100b963ea439782b1696be`.

Delivered provider-neutral adapter interfaces, SQLite reference wrappers, interface-driven phase execution, unchanged R2 atomicity, publication/maintenance type separation, and conformance through the full seven-class chain.

Final R3A CI run `30699572665` passed workflow guard, lint, type-check, runner checks, complete unit suite, clean migrations, build, and browser smoke.

### R3B — Committed generic reader

Status: **implementation and validation passed in PR #1098; merge pending**.

Delivered on the branch:

- immutable read fences bound to source, network, epoch, base, committed ledger/hash, and work;
- latest exact lookup by semantic class and canonical key;
- deterministic semantic-class listing;
- deterministic ledger-range listing;
- canonical relationship lookup;
- source/query/order/fence-bound opaque cursors with SHA-256 integrity;
- stale-fence, source mismatch, query mismatch, tamper, invalid offset, and malformed shape rejection;
- committed-only filtering with staged rows invisible;
- strict row/work identity, hash, relationship, tombstone, and canonical-value validation;
- storage parse failures normalized to `integrity_failure` with no legacy fallback.

The SQLite reader suite proves latest exact selection across multiple committed works, stable pagination, ledger-range and relationship queries, tombstone retention, staged-row exclusion, cursor tamper/source/query/fence rejection, and malformed committed identity failure.

Retained CI evidence from run `30699923812`:

- workflow-surface guard passed;
- lint passed;
- TypeScript type-check passed;
- production runner bundle and configuration validation passed;
- complete unit-test suite passed;
- complete clean local migration sequence passed, including migration `10006`;
- application build passed;
- browser smoke passed.

The first R3B CI run exposed only the TypeScript Web Crypto `BufferSource` boundary. Cursor bytes are now copied into a dedicated `ArrayBuffer` before hashing. Cursor identity and behavior were unchanged.

R3B is recorded complete only after PR #1098 merges to `main`.

### R3C — Product mappers and shadow compatibility

Status: **next after PR #1098 merges**.

Required work:

- strict versioned mappers for all seven semantic classes;
- explicit portable source descriptors;
- `legacy_only` and `shadow_compare` selection only;
- deterministic bounded comparison evidence;
- no portable/legacy mixing inside one response;
- no silent legacy fallback after integrity, identity, digest, cursor, or partial-read failure;
- no public authority change.

### R3D–R3E

- R3D: publication and maintenance reference implementations;
- R3E: cross-adapter export/restore and parent R3 exit.

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
- Do not make a provider dashboard, local terminal, or paid runtime dependency part of routine recovery.
- Do not call a theoretical no-cost projection an operating result.
