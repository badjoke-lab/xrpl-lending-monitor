# Development roadmap

Baseline date: 2026-07-01.
Last recalibrated: 2026-07-03.

This document controls implementation order and dependencies. Dates are planning targets rather than promises. Correctness, data integrity, accessibility, and release evidence take priority over calendar targets.

The detailed M1 execution sequence is defined by [`d1-migration-plan.md`](d1-migration-plan.md). When this roadmap and that plan differ on M1 order or remote-operation gates, the D1 migration plan controls until M1 exits.

## Milestone summary

| Milestone | Status | Goal | Exit condition |
|---|---|---|---|
| M0 Foundation and specification lock | Complete | Establish repository, source-of-truth documents, toolchain, and operating rules | Documentation accepted and project skeleton ready |
| M1 Current-state collector | D1-only closeout active | Connect Devnet, scan current objects, and create the first active snapshot | Complete marker-aware D1 snapshot stored, verified, activated, and followed by safe incremental collection |
| M2 Event history and lifecycle | Complete through Checkpoint B | Normalize validated history, lifecycle, archives, balances, and status | Deterministic replay and reconciliation work complete |
| M3 Public API | Complete through exports and feeds | Expose bounded read-only current and historical APIs | Contract tests pass and unavailable states are explicit |
| M4 Baseline UI and project pages | Complete through Checkpoint C | Deliver the ordinary monitor, navigation, project pages, responsive behavior, and shared states | Required baseline routes work end to end |
| M5 Differentiated audit UI | Complete through M5-4; M5-5 deferred behind M1 | Add lifecycle, archives, cover/loss, epochs, and provenance integration | Audit integration passes against verified real data |
| M6 Hardening and public Devnet release | Not started | Prove integrity, resource safety, accessibility, operations, and deployment readiness | Multi-day soak and all release gates pass |

## Cross-cutting rules

- Current-state pages show explicit unavailable states until a verified active snapshot exists.
- No page invents values to appear complete.
- Devnet and Mainnet data never mix.
- Mainnet, wallet, signing, transaction submission, funding, payments, pricing, fiat conversion, cross-asset totals, and proprietary risk scores remain outside scope.
- Generated mockups are visual references only.
- The public Worker uses one D1 binding, `DB`, for history and current-state snapshots.
- Bootstrap is an explicit operator process. Bootstrap, verification, and activation remain separate operations.
- Remote migration, production bootstrap, and active-pointer mutation are not implied by code merge or web deployment.

## M0 — Foundation and specification lock

Complete.

Delivered product, architecture, data, status, asset, collector, testing, resource, roadmap, D1 migration, and UI specifications; pinned toolchain; local and production boundaries; and Mainnet fail-closed configuration.

## M1 — Current-state collector

### Completed foundation

- network, amendment, epoch, reset, and synchronization state;
- canonical XRP, IOU, and MPT normalization;
- complete unfiltered marker traversal primitives;
- exact-marker resumable batches;
- current object normalization and relationship checks;
- terminal Loan zero-omission handling;
- long-running bootstrap runner;
- complete-manifest verification contract;
- active-snapshot activation invariants;
- D1 snapshot schema, bounded writers, verified readers, and bootstrap integration;
- controlled interruption and resume evidence;
- migration-before-activation unavailable behavior.

The earlier external object-storage implementation is superseded. M1 uses versioned D1 snapshot rows through one runtime D1 binding.

### M1-D1-0 — Documentation and dependency lock

- add the canonical D1 migration plan;
- align roadmap, implementation status, and decision record;
- lock dependency order before implementation continues.

Exit condition: documentation is merged before the remaining open implementation work.

### M1-D1-1 — Snapshot retention safeguards

- real local D1 rollback integration tests;
- verified-manifest and same-epoch restore requirements;
- guarded active and rollback pointer swap;
- guarded `sync_state` restore;
- protected-snapshot cleanup rejection;
- cleanup eligibility and time enforcement.

Exit condition: rollback and cleanup safety pass local migrations, full tests, and CI.

### M1-D1-2 — Single D1 runtime binding

- remove the legacy `CURRENT_STATE` runtime binding;
- use `DB` for current entity readers;
- preserve explicit unavailable behavior before migration or activation;
- keep all current reads snapshot and epoch scoped.

Exit condition: one D1 binding serves history and verified current state without weakening unavailable states.

### M1-D1-3 — D1-only local integration closeout

- remove or isolate superseded D1-plus-R2 active paths;
- test begin, bounded write, interruption, exact-marker resume, verification, activation, read, rollback, and cleanup;
- reject changed ledger identity and invalid relationships;
- prove retry idempotency and completed-snapshot immutability.

Exit condition: local migration, integration, `pnpm check`, and browser validation pass.

### M1-D1-4 — Operator bootstrap and measurement harness

- separate status, bootstrap or resume, verify, measure, activate, restore, and cleanup actions;
- require explicit fixed ledger index and hash;
- default to no activation;
- emit public-safe machine-readable evidence;
- cap pages, objects, rows, statements, retries, and execution time.

Exit condition: a complete local bootstrap can be operated without a public write route or implicit activation.

### M1-D1-5 — Complete local bootstrap and resource gate

Measure before any remote mutation:

- object count;
- raw and normalized bytes;
- projected D1 storage including indexes, history, active snapshot, and one rollback snapshot;
- maximum row and batch size;
- rows written and queries executed;
- API rows read and latency;
- interruption, resume, verification, activation, rollback, and cleanup behavior.

Stop before remote use if projected total database use exceeds the documented 350 MB safety threshold or another measured D1 or runtime boundary is unsafe.

### M1-D1-6 — Remote additive migration

After local evidence review:

- read remote migration and database state;
- apply only reviewed additive schema changes beginning with `0009_d1_current_state_snapshots.sql`;
- verify empty current-state structures;
- verify public APIs remain unavailable before activation.

### M1-D1-7 — Production bootstrap and verification

- fix one validated Devnet ledger index and hash;
- complete every marker through bounded resumable runs;
- verify every object and batch hash and the complete manifest;
- verify same-snapshot relationships;
- compare production resource evidence with the local projection;
- leave the verified snapshot inactive.

### M1-D1-8 — Explicit activation and rollback proof

- activate only the verified complete snapshot through a separate action;
- validate Overview, current entities, Search, Account, epoch, and relationships;
- demonstrate retained rollback behavior;
- confirm incomplete attempts remain guarded.

### M1-D1-9 — Incremental continuation and M1 exit

- start the incremental collector from the ledger after the active snapshot ledger;
- verify contiguous cursor and parent-hash continuity;
- verify idempotent retries, projection updates, lifecycle, archives, balance history, and reset handling;
- reconcile bootstrap current state with incremental history.

M1 exits only when the complete snapshot is stored, verified, active, serving real Devnet data, and followed by safely advancing incremental collection.

## M2 — Event history and lifecycle

Complete in dependency order:

1. incremental validated-ledger foundation;
2. AffectedNodes normalization;
3. Loan lifecycle engine;
4. archived-object retention;
5. cover, debt, and loss tracking;
6. status engine and reconciliation;
7. Checkpoint B history decision.

Public completeness claims remain bounded by collection start, active-snapshot verification, reconciliation, and later soak evidence.

## M3 — Public API

Complete:

- status and overview;
- Vault, Loan Broker, and Loan list/detail contracts;
- activity and transaction detail;
- search and account relationships;
- epochs and object history;
- lifecycle, archives, cover/loss audit endpoints;
- bounded exports and feeds.

Current entity endpoints remain unavailable until M1 activation.

## M4 — Baseline UI and project pages

Complete through Checkpoint C:

- responsive application shell;
- Overview and Network Status;
- Vault, Loan Broker, and Loan list/detail pages;
- Activity, transaction, Search, and account pages;
- About, Methodology, API, and Contact pages;
- shared loading, empty, unavailable, stale, partial, error, archived, not-found, and invalid-identifier states;
- responsive and accessibility coverage.

## M5 — Differentiated audit UI

Complete:

- M5-1 Loan lifecycle and state changes;
- M5-2 archived objects;
- M5-3 cover, debt, and loss;
- M5-4 Devnet epochs and provenance.

Deferred until M1 activation:

- M5-5 cross-audit integration, exports, real-data regression, and consistency checks.

## M6 — Hardening and public Devnet release

Proceed after M5-5:

1. integrity and reset simulations;
2. runtime and resource guardrails;
3. accessibility, performance, security, and browser validation;
4. operations and deployment documentation;
5. real multi-day soak and final release verification.

Soak evidence is real elapsed evidence and is never fabricated or compressed.
