# Development roadmap

Baseline date: 2026-07-01.
Last recalibrated: 2026-07-04.

This document controls implementation order and dependencies. Dates are planning targets rather than promises. Correctness, data integrity, accessibility, and release evidence take priority over calendar targets.

The current M1 execution path is a verified immutable base read model plus bounded D1 incremental history and current-state overlay. The earlier D1-only full-snapshot plan is retained as architectural history in [`d1-migration-plan.md`](d1-migration-plan.md) but no longer controls active implementation order.

## Milestone summary

| Milestone | Status | Goal | Exit condition |
|---|---|---|---|
| M0 Foundation and specification lock | Complete | Establish repository, source-of-truth documents, toolchain, and operating rules | Documentation accepted and project skeleton ready |
| M1 Current-state collector | Incremental continuation active | Serve a verified Devnet base state and continuously apply validated ledger changes | Verified base read model serves real Devnet data; contiguous scheduled collection, D1 overlay updates, deletion handling, reconciliation, and stale/gap safety pass |
| M2 Event history and lifecycle | Complete through Checkpoint B | Normalize validated history, lifecycle, archives, balances, and status | Deterministic replay and reconciliation logic complete; production completeness remains bounded by M1 continuation and later soak evidence |
| M3 Public API | Complete through exports and feeds; current merge integration pending | Expose bounded read-only current and historical APIs | Base-plus-overlay current routes and historical contracts pass, with explicit freshness and unavailable states |
| M4 Baseline UI and project pages | Complete through Checkpoint C | Deliver the ordinary monitor, navigation, project pages, responsive behavior, and shared states | Required baseline routes work end to end; live freshness claims remain gated by M1 |
| M5 Differentiated audit UI | Complete through M5-4; M5-5 deferred behind M1 | Add lifecycle, archives, cover/loss, epochs, and provenance integration | Audit integration passes against verified real data after M1 exits |
| M6 Hardening and public Devnet release | Not started | Prove integrity, resource safety, accessibility, operations, and deployment readiness | Multi-day soak and all release gates pass |

## Cross-cutting rules

- No page invents values to appear complete.
- Devnet and Mainnet data never mix.
- Mainnet, wallet, signing, transaction submission, funding, payments, pricing, fiat conversion, cross-asset totals, and proprietary risk scores remain outside scope.
- Generated mockups are visual references only.
- The public Worker uses one D1 binding, `DB`, for network state, cursors, normalized history, overlays, tombstones, aggregates, and operational state.
- Complete base read models are immutable, versioned, manifest verified, and replaced only through an explicit publication process.
- Incremental history and current-state overlay changes advance from the same validated-ledger cursor boundary.
- A D1 overlay upsert overrides the base object; a deletion tombstone hides the base object; absence of an overlay record falls back to the verified base.
- Gap, stale, partial, and unavailable states are explicit. A stale base plus interrupted incremental continuation is never presented as fresh.
- Internal account circumstances, credentials, provider identifiers, workflow run identifiers, and unpublished operational details remain outside public documentation.

## M0 — Foundation and specification lock

Complete.

Delivered product, architecture, data, status, asset, collector, testing, resource, roadmap, and UI specifications; pinned toolchain; local and production boundaries; and Mainnet fail-closed configuration.

## M1 — Current-state collector

### Completed foundation

- network, amendment, epoch, reset, and synchronization state;
- canonical XRP, IOU, and MPT normalization;
- complete unfiltered marker traversal primitives;
- exact-marker resumable bootstrap batches;
- current object normalization and relationship checks;
- terminal Loan zero-omission handling;
- long-running bootstrap runner;
- deterministic compressed artifact generation;
- complete manifest verification;
- verified full Devnet base snapshot materialization;
- lightweight current-state read-model compilation;
- immutable base data publication and active channel resolution;
- bounded current Vault, Loan Broker, and Loan list/detail readers;
- bounded pagination, exact identifier lookup, filters, relationships, and search validation;
- incremental validated-ledger scan foundation;
- AffectedNodes normalization;
- Loan lifecycle derivation;
- deleted-object archive derivation;
- cover, debt, and loss history derivation;
- deterministic cursor and parent-hash continuity checks.

The row-per-object D1 full-snapshot approach exceeded the project resource safety envelope in measured projection and does not proceed to production. M1 now completes through a verified immutable base read model plus bounded D1 incremental history and current-state overlay.

### M1-HYB-0 — Documentation and dependency realignment

Target: 2026-07-04.

- supersede the D1-only current-state decision;
- align architecture, collector design, resource envelope, implementation status, and roadmap;
- retain the evaluated D1-only plan as historical evidence rather than an active execution plan;
- define public-safe base-plus-overlay semantics and the new dependency order.

Exit condition: source-of-truth documents agree with the implemented base read path and the next incremental work.

### M1-HYB-1 — D1 incremental overlay foundation

Target: 2026-07-05.

- add bounded overlay records for created and modified current objects;
- add deletion tombstones for objects removed after the base ledger;
- bind every overlay row to network, epoch, base snapshot identity, ledger, and transaction evidence;
- add overlay watermark and indexes required by detail, list, search, relationship, and overview reads;
- prove idempotent replay and fail-closed base identity mismatch behavior.

Exit condition: replay creates no duplicate canonical overlay state, deletion cannot fall through to the base, and base mismatch fails closed.

### M1-HYB-2 — Incremental projection integration

Target: 2026-07-06.

- derive current projection upserts from supported CreatedNode and ModifiedNode changes;
- derive current-state tombstones from DeletedNode changes;
- persist history, lifecycle, archive, balance, overlay, and cursor movement at the documented canonical commit boundary;
- keep cursor and parent-hash gap rejection intact;
- prove all-or-nothing advancement between historical evidence and current-state overlay.

Exit condition: history and current overlay advance together or neither advances.

### M1-HYB-3 — Base-plus-overlay API integration

Target: 2026-07-07.

- merge base and overlay semantics into Overview;
- merge Vault list/detail reads;
- merge Loan Broker list/detail reads;
- merge Loan list/detail reads;
- merge exact Search and Account/relationship reads;
- ensure tombstones suppress current results and route users to indexed archive context where available;
- expose base identity, overlay watermark, collector cursor, and freshness metadata.

Exit condition: current entity routes deterministically resolve overlay upsert > base, tombstone > hidden, otherwise base.

### M1-HYB-4 — Scheduled incremental collector wiring

Target: 2026-07-08.

- connect bounded incremental ledger processing to the scheduled Worker path;
- retain network-status refresh independently;
- cap ledgers, requests, statements, rows, retries, and execution time per run;
- process only contiguous validated ledger ranges;
- catch up across multiple runs instead of skipping or over-running runtime limits;
- expose lag, stale state, error state, and last successful cursor.

Target cadence: once per minute, subject to measured Worker, D1, and RPC evidence. The interface reports actual freshness rather than assuming the target cadence was met.

Exit condition: scheduled runs advance contiguously, restart safely, and remain within measured guardrails.

### M1-HYB-5 — Catch-up rehearsal and reconciliation

Target: 2026-07-09.

- rehearse catch-up from a fixed base ledger plus one;
- interrupt and resume collection;
- replay already processed ranges;
- verify parent-hash continuity;
- reconcile base counts plus created/deleted overlay deltas;
- reconcile Vault to Loan Broker and Loan Broker to Loan relationships;
- verify deleted objects are absent from current routes and retained in indexed history where collected.

Exit condition: catch-up, interruption, replay, and reconciliation evidence pass without current/history divergence.

### M1-HYB-6 — Bounded production catch-up

Target start: 2026-07-10.

- begin bounded production catch-up from the ledger after the active verified base snapshot;
- preserve the fixed base identity while the overlay advances;
- stop on any gap, parent-hash discontinuity, reset signal, or persistence failure;
- expose actual lag until catch-up reaches the validated head.

Exit condition: production cursor reaches the validated head without a gap and current routes reflect base plus applied overlay.

### M1-HYB-7 — Continuous Devnet monitoring verification

Target: 2026-07-11.

Verify real observed paths for:

- newly created current objects;
- modified current objects;
- Loan payment changes;
- impairment, unimpairment, and default state transitions;
- deletion and archive handling;
- Activity, lifecycle, balance history, and current-state consistency;
- lag and freshness reporting.

Exit condition: the live continuation path is operational and evidence shows current and historical views remain consistent.

### M1-HYB-8 — M1 exit review

Target: 2026-07-12.

M1 exits only when:

- a verified base read model is serving real Devnet current data;
- the incremental cursor advances contiguously;
- current overlay upserts and tombstones are applied safely;
- restart and retry are idempotent;
- bounded catch-up works after interruption;
- stale or incomplete data is never labeled fresh;
- reconciliation passes.

## M2 — Event history and lifecycle

Complete in dependency order:

1. incremental validated-ledger foundation;
2. AffectedNodes normalization;
3. Loan lifecycle engine;
4. archived-object retention;
5. cover, debt, and loss tracking;
6. status engine and reconciliation;
7. Checkpoint B history decision.

Historical logic is implemented, but production completeness remains bounded by the collection start, M1 contiguous continuation, reconciliation, and later soak evidence.

## M3 — Public API

Complete through contracts, exports, and feeds:

- status and overview;
- Vault, Loan Broker, and Loan list/detail contracts;
- activity and transaction detail;
- search and account relationships;
- epochs and object history;
- lifecycle, archives, cover/loss audit endpoints;
- bounded exports and feeds.

The active M1 work integrates base-plus-overlay current reads and freshness metadata into the current entity routes. Historical APIs remain bounded by collected evidence.

## M4 — Baseline UI and project pages

Complete through Checkpoint C:

- responsive application shell;
- Overview and Network Status;
- Vault, Loan Broker, and Loan list/detail pages;
- Activity, transaction, Search, and account pages;
- About, Methodology, API, and Contact pages;
- shared loading, empty, unavailable, stale, partial, error, archived, not-found, and invalid-identifier states;
- responsive and accessibility coverage.

The UI must not claim real-time freshness until M1 incremental continuation and actual freshness reporting are operational.

## M5 — Differentiated audit UI

Complete:

- M5-1 Loan lifecycle and state changes;
- M5-2 archived objects;
- M5-3 cover, debt, and loss;
- M5-4 Devnet epochs and provenance.

### M5-5 — Cross-audit real-data integration

Target: 2026-07-13 through 2026-07-14, after M1 exit.

- cross-audit integration;
- bounded exports against the live evidence boundary;
- real-data browser regression;
- current/history consistency checks;
- lifecycle/current-object cross-checks;
- archive/current exclusion checks.

Exit condition: audit integration passes against verified base-plus-overlay current state and indexed real history.

## M6 — Hardening and public Devnet release

Target start: 2026-07-15, after M1 exit and M5-5.

Proceed in dependency order:

1. integrity and reset simulations;
2. runtime and resource guardrails;
3. accessibility, performance, security, and browser validation;
4. operations and deployment documentation;
5. backup/export and recovery verification;
6. real multi-day Devnet soak;
7. final release verification.

Completion has no artificial date. Soak evidence requires real elapsed time and is never fabricated or compressed.