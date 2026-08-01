# Implementation status

Last updated: `2026-08-01`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The fixed-ledger-count Queue recovery is retired. Production evidence on Issue #1079 proved that a one-minute 32-ledger chain can still halt on a content-dependent Worker subrequest limit. The chain stopped with terminal lag `56,740`; no stabilization qualification or 24-hour soak is active.

The public read surface remains a production test surface backed by the last verified immutable base plus committed live data. Mainnet remains disabled.

## Controlling recovery design

The controlling recovery design is [`ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md`](ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md).

The parent R2 contract is [`ops/r2-portable-runtime-contract-2026-08-01.md`](ops/r2-portable-runtime-contract-2026-08-01.md).

The active R2b implementation contract is [`ops/r2b-normalized-payload-phase-runtime-2026-08-01.md`](ops/r2b-normalized-payload-phase-runtime-2026-08-01.md).

The replacement collector preserves every public and semantic requirement while separating the collector contract from any one hosted runtime:

- adaptive scan work bounded by actual transaction, byte, CPU, wall-time, and external-request budgets;
- resumable commit chunks bounded by adapter-specific storage limits;
- one small atomic finalization step that alone advances the cursor and committed watermark;
- work-scoped current/history rows invisible until finalization;
- a SQLite reference implementation and shared adapter conformance tests;
- provider-neutral storage, scheduler, execution, and publication interfaces;
- separate bounded maintenance and Git-backed immutable publication;
- deployment-profile selection only after measured no-cost, cadence, export, rollback, and failure-mode qualification.

A fixed ledger count and a provider-specific invocation shape are no longer accepted as safety boundaries.

## Current production evidence

Controlling checkpoint: Issue #1079.

- network: `devnet`
- Mainnet enabled: `false`
- active Worker version at failure: `fb27bd55-e624-439d-add2-2ed41e903c34`
- Worker Cron: empty
- last completed slot: `2026-08-01T03:52:00Z`
- failed slot: `2026-08-01T03:53:00Z`
- failure: `Too many subrequests by single Worker invocation`
- last processed ledger: `4,051,454`
- latest observed ledger: `4,108,194`
- terminal lag: `56,740`
- successor chain: halted
- 24-hour soak: not started

A configured remote queue does not mean the collector is operating when no successor exists. The halted Cloudflare deployment remains evidence and rollback context only.

## Active implementation order

### R0 — Contract and portability reset

Status: **complete** in merged PR #1081 (`c077e7b16b8b08213bbadcc5e927bba0f9472f6c`).

Delivered:

- retired the fixed-32-ledger recovery and its qualification path;
- rewrote runtime, resource, status, and recovery schedule documents around provider-neutral contracts;
- defined `StorageAdapter`, `SchedulerAdapter`, `ExecutionAdapter`, and `PublicationAdapter` boundaries;
- selected SQLite as the reference implementation for local and CI proof;
- froze remote recovery until the adapter contract and deployment-profile gate exist.

Exit condition passed: source-of-truth documents agree, contain technical rationale only, and no hosted provider is treated as the required architecture.

### R1 — Reference schema and deterministic planner

Status: **complete** in merged PR #1082 (`85f42e665a5e6f2f519cd372718b9c41c16b3f68`).

Delivered:

- implementation-neutral collector work, payload chunk, commit chunk, reference-row, and committed-watermark schema;
- real SQLite reference storage for idempotent staging, hidden partial rows, guarded atomic finalization, cursor-parent enforcement, and deterministic export;
- deterministic adaptive candidate planning from actual per-ledger transaction, byte, payload, and request estimates;
- the R1 scan ceiling of 48 ledgers as a candidate ceiling rather than a persistence-safety claim;
- deterministic complete-state restoration into a second empty SQLite database with canonical byte-for-byte re-export parity;
- sparse, dense/content-heavy, oversized-single-ledger, discontinuity, incomplete-commit, idempotent-finalize, visibility, watermark, export, restore, and non-empty-restore rejection tests.

Retained CI evidence:

- minimal Actions workflow surface guard passed;
- lint passed;
- TypeScript type-check passed;
- production runner bundle and configuration validation passed;
- the complete unit-test suite passed;
- the complete existing local migration sequence, including `10004_portable_collector_work.sql`, passed on a clean local database;
- application build passed;
- browser smoke passed.

The first CI attempt exposed one discontinuity-test fixture that placed its witness beyond the declared validated head. The fixture was corrected to test an actual missing ledger inside the declared range. No planner budget or safety condition was weakened.

Exit passed: local SQLite and CI prove atomic finalization, committed-only visibility, deterministic planning and replay, complete export, and complete restore.

### R2 — Provider-neutral scan, commit, and finalize runtime

Status: **active** under merged contract PR #1083 (`bd1ac985de908bd2f01089304c202ab47d368c9b`).

#### R2a — Typed messages and durable scheduler

Status: **complete** in merged PR #1084 (`f68aea25f6d3b973ceec79e09288fdf626f33bdc`).

Delivered:

- canonical versioned `scan`, `commit`, and `finalize` messages with deterministic semantic IDs;
- strict message-field validation and the 16,000-byte control-message guard;
- durable SQLite scheduler inbox with `pending`, `leased`, `completed`, and `error` states;
- fresh-lease theft rejection and deterministic stale-lease recovery;
- retryable transport/storage handling that preserves the same message identity and phase cursor;
- terminal failure handling that records the exact classification and publishes no successor;
- atomic current-message completion, optional work mutation, and timed successor-outbox reservation;
- idempotent outbox dispatch and duplicate-completion convergence;
- durable successor availability that cannot be recomputed or changed during dispatch;
- complete runtime export/restore including work, payload chunks, commit chunks, candidate rows, watermarks, scheduler messages, active leases, retry metadata, outbox rows, and reserved successor times;
- canonical byte-for-byte runtime re-export parity after restoration into a second empty SQLite database.

Retained CI evidence from runs `30691175822` and `30691338208`:

- minimal Actions workflow surface guard passed;
- lint passed;
- TypeScript type-check passed;
- production runner bundle and configuration validation passed;
- the complete unit-test suite passed;
- the complete local migration sequence, including `10005_portable_scheduler.sql`, passed on a clean database;
- application build passed;
- browser smoke passed.

R2a tests prove deterministic message identity, byte guards, lease ownership, stale reclaim, atomic rollback, retry identity, terminal halt, timing-conflict rejection, idempotent completion and dispatch, and exact runtime export/restore.

#### R2b — Normalized payload and bounded phase runtime

Status: **active contract phase** in `ops/r2b-normalized-payload-phase-runtime-2026-08-01.md`. Runtime code begins only after that contract reaches `main`.

R2b implementation unit:

- implement the seven-class `NormalizedCollectorPayloadV1` envelope and common candidate identity;
- implement canonical SHA-256 payload and chunk digests;
- implement deterministic semantic counts, sorting, duplicate rejection, and bounded chunking;
- implement scan-only staging through the R1 work schema;
- implement bounded resumable commit execution through the R2a scheduler;
- expose transaction-aware finalization so scheduler-owned phase completion does not nest SQLite transactions;
- implement scheduler-integrated finalize and next-scan selection without early visibility;
- implement deterministic fixture `ExecutionAdapter` with interruption, retry, reset, identity, hash, digest, and resource-failure injection;
- pass every interruption and semantic-survival test required by the R2 and R2b contracts.

R2 is not complete until R2b and the complete R2 exit suite pass and merge to `main`.

### R3 — Adapters, overlay, maintenance, and publication separation

- implement storage and scheduler adapter conformance suites;
- make current/history queries read committed work only;
- compact superseded hot rows safely;
- preserve hybrid API behavior and legacy rows during migration;
- keep immutable publication separate from the normal collection scheduler;
- prove that a complete state export can be restored into a second adapter.

Exit: SQLite reference, adapter parity, API parity, deterministic archive/replay, and cross-adapter restore tests pass with no semantic-count loss.

### R4 — Deployment-profile qualification

- implement guarded deployment and rollback tooling for candidate remote profiles;
- test scheduler cadence, XRPL WebSocket support, transactional storage, export, recovery, and fail-closed limits;
- reject profiles that require a paid operating dependency, automatic paid overage, or routine interactive operator steps;
- select no production profile until production-shaped evidence passes;
- retain pre/post snapshots and Issue evidence for every remote mutation.

Exit: at least one candidate profile passes the adapter suite and a read-only/shadow qualification; production remains halted until an explicit recovery PR is merged.

### R5 — Controlled shadow and production recovery

- deploy only the selected qualified profile;
- verify one staged work item end to end;
- run a fixed two-hour catch-up qualification;
- prove rollback, export, and restoration before continuing;
- continue only when throughput, continuity, semantic, scheduler, runtime, storage, and no-cost operating gates pass.

Exit: exact contiguous cursor advance, zero semantic loss, zero resource-limit errors, and fail-closed rollback are proven.

### R6 — Lag zero and steady qualification

- reach lag zero automatically;
- transition from catch-up to the selected steady cadence;
- pass twelve consecutive five-minute freshness checkpoints;
- prove immutable/live/current agreement and no hidden partial work;
- prove the selected profile remains inside its measured no-cost envelope.

Exit: lag zero and five-minute freshness are stable without manual intervention.

### R7 — Formal operation evidence

- arm independent immutable audit retention;
- pass a fixed 24-hour evidence window;
- pass seven days of continuous operation;
- only then reopen formal Devnet release qualification.

## Acceptance limits

The reconstructed runtime is not approved until production-shaped evidence proves:

- steady committed throughput greater than 21 ledgers/minute;
- catch-up committed throughput greater than 30 ledgers/minute;
- selected scheduler operations remain inside its measured daily guard;
- selected storage reads, writes, queries, and physical size remain inside project stop thresholds;
- zero subrequest, CPU, memory, query-count, row-size, hidden-partial-work, and paid-overage events;
- complete export and restore into the reference format;
- no supported semantic record loss;
- no gap, hash discontinuity, or cursor advancement before full finalization.

Provider-specific numeric ceilings belong in the selected deployment profile, not in the collector-core contract.

## Remaining release gates

After R7:

1. complete the final semantic cross-audit against XRPL transactions and AffectedNodes;
2. complete real-data browser regression and representative production behavior smoke;
3. complete integrity, reset, backup, restore, replay, and rollback verification;
4. complete Explorer v1 if it remains a release requirement after roadmap reconciliation;
5. complete desktop/mobile visual, accessibility, performance, security, and cross-browser audits;
6. configure the final public host, canonical metadata, sitemap, Search Console, analytics, and feedback routes;
7. freeze operations runbooks, watchdogs, alerts, backup, and recovery procedures;
8. produce the final release record and owner sign-off.

## Operating restrictions

- Do not describe the collector as operating while its successor or lease chain is absent.
- Do not restart the retired fixed-32-ledger runtime.
- Do not select a hosted provider before R4 qualification.
- Do not use GitHub Actions as the normal collection clock.
- Do not start stabilization or soak before R6.
- Do not enable Mainnet.
- Do not remove semantic history classes or public product capabilities.
- Do not skip a failed ledger or advance a cursor after partial persistence.
- Do not make a provider dashboard, local terminal, or paid runtime dependency part of routine recovery.
- Do not call a theoretical no-cost projection an operating result.
