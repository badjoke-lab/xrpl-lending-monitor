# Development roadmap

Baseline date: 2026-07-01.

This document controls implementation order and dependencies. Dates are planning targets rather than promises. Correctness, data integrity, accessibility, and release evidence take priority over calendar targets.

## Milestone summary

| Milestone | Status | Goal | Exit condition |
|---|---|---|---|
| M0 Foundation and specification lock | Complete | Establish repository, source-of-truth documents, toolchain, and operating rules | Documentation accepted and project skeleton ready |
| M1 Current-state collector | D1-only closeout active | Connect Devnet, scan current objects, and create the first active snapshot | Complete marker-aware D1 snapshot stored, verified, and activated |
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

## M0 — Foundation and specification lock

Complete.

Delivered product, architecture, data, status, asset, collector, testing, resource, roadmap, and UI specifications; pinned toolchain; local and production boundaries; and Mainnet fail-closed configuration.

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
- active-snapshot activation and rollback invariants;
- controlled interruption and resume evidence.

The earlier external object-storage implementation is superseded. M1 now uses versioned D1 snapshot rows.

### M1-closeout-1 — D1-only local implementation

- additive D1 schema for snapshots, manifests, bounded batches, typed Vault/Broker/Loan rows, active pointer, checkpoints, hashes, and cleanup eligibility;
- inactive-snapshot writes;
- exact marker advancement only after durable batch completion;
- immutable completed snapshots;
- atomic active-pointer switch;
- active-plus-one-rollback retention;
- bounded current-object API readers;
- local migration, interruption, retry, rollback, cleanup, and relationship tests.

### M1-closeout-2 — Resource measurement

Measure before any remote bootstrap:

- object count;
- raw and normalized bytes;
- projected D1 storage including indexes, history, active snapshot, and one rollback snapshot;
- maximum row and batch size;
- rows written and queries executed;
- API rows read and latency.

Stop before remote use if projected total database use exceeds the documented 350 MB safety threshold.

### M1-closeout-3 — Remote migration and verified activation

After review:

- apply only additive schema changes;
- fix one validated Devnet ledger index and hash;
- complete every marker;
- verify every object and batch hash and the complete manifest;
- verify same-snapshot relationships;
- activate only the verified complete snapshot;
- demonstrate rollback and bounded incomplete-attempt handling;
- start and verify incremental collection.

M1 exits only when the complete snapshot is stored, verified, active, and serving real Devnet current data.

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
