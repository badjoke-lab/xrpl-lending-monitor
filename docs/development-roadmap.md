# Development roadmap

Baseline date: 2026-07-01.

This document controls implementation order, dependencies, and target windows. Dates are planning targets rather than promises. Correctness, data integrity, and release gates take priority over calendar targets.

## Milestone summary

| Milestone | Target window | Goal | Exit condition |
|---|---|---|---|
| M0 Foundation and specification lock | 2026-07-01 to 2026-07-04 | Establish repository, source-of-truth documents, toolchain, and operating rules | Documentation accepted and project skeleton ready |
| M1 Current-state collector | 2026-07-05 to 2026-07-12 | Connect Devnet, manage epochs, scan current objects, and create the first active snapshot | Complete marker-aware current-state bootstrap stored and activated |
| M2 Event history and lifecycle | 2026-07-13 to 2026-07-24 | Collect validated ledgers, normalize changes, reconstruct lifecycle, and preserve deletions | Deterministic replay and archive queries pass |
| M3 Public API | 2026-07-25 to 2026-07-31 | Expose bounded read-only core and history APIs | Contract tests pass for baseline entities and history |
| M4 Baseline UI | 2026-08-01 to 2026-08-12 | Deliver ordinary monitoring pages and navigation | Overview, lists, details, activity, search, and status work end to end |
| M5 Differentiated audit UI | 2026-08-13 to 2026-08-20 | Add lifecycle, state changes, cover history, archives, epochs, and provenance | Audit views complete without baseline regressions |
| M6 Hardening and public Devnet release | 2026-08-21 to 2026-08-31 | Prove integrity, resource safety, accessibility, and operations | Soak test and release gates pass |

The schedule was recalibrated after the current-object scanner benchmark. Full bootstrap is separated from the scheduled Worker because measured global marker traversal does not fit a normal scheduled invocation.

## M0 — Foundation and specification lock

### PR 1 — Repository operating foundation

- README and documentation index;
- contributor and coding-agent rules;
- PR template;
- implementation status and decision records.

### PR 2 — Product and architecture specification

- product, architecture, data, status, and asset models;
- collector and testing design;
- resource envelope;
- competitor positioning;
- development roadmap.

### PR 3 — Project skeleton

- pinned Node, pnpm, TypeScript, React, Vite, Worker, D1, Hono, Vitest, Playwright, ESLint, and CI setup;
- local, preview, and production boundaries;
- Mainnet fail-closed configuration.

## M1 — Current-state collector

### PR 4 — Network, amendment, and epoch foundation

- endpoint configuration and fallback;
- server and validated-ledger status;
- amendment status;
- epoch and synchronization state;
- reset-signal detection;
- read-only status API.

### PR 5 — Asset normalization

- XRP normalization;
- IOU currency-and-issuer identity;
- MPT issuance identity and metadata;
- decimal-safe amount and rate utilities;
- Ripple epoch conversion.

### PR 6 — Current object scanner and collector benchmark

- complete marker traversal primitives for Vault, LoanBroker, and Loan;
- one unfiltered binary traversal with local classification;
- resumable exact-marker batches;
- current projections and relationship checks;
- terminal Loan zero-omission handling;
- partial-scan failure behavior;
- CPU, request, memory, storage, and catch-up measurements;
- collector runtime and cadence selection.

### PR 6B — Bootstrap runner and storage integration

- long-running resumable bootstrap execution;
- fixed validated-ledger identity across resumed batches;
- exact marker checkpoint persistence;
- bounded compressed shard generation;
- external shard upload and retries;
- complete manifest generation and verification;
- cleanup of incomplete attempts;
- D1 snapshot metadata and active-pointer activation;
- preview full-bootstrap and resume test.

PR 6B is required before M1 exits. Incremental collection cannot maintain a snapshot that has never been bootstrapped and activated.

## M2 — Event history and lifecycle

### PR 7 — Incremental validated-ledger collector

Cursor-based processing, recognized transaction filtering, idempotency, bounded catch-up, retry behavior, raw-payload controls, and integration with the active bootstrap snapshot.

### PR 8 — AffectedNodes normalization

Created, modified, and deleted nodes; before-and-after changes; object IDs; unknown-field logging; and transaction relationships.

### PR 9 — Loan lifecycle engine

Creation terms, regular and full payments, confirmed overpayment behavior, impair, unimpair, default, delete, ordering, and final-state retention.

### PR 10 — Deleted-object archive

Vault, Broker, and Loan final states, deletion classification, archived relationships, and search aliases.

### PR 11 — Cover, debt, and loss tracking

Cover history, debt history, unrealized loss, required-cover formulas, surplus or shortfall, and asset-separated aggregates.

### PR 12 — Status engine and reconciliation

On-ledger status, schedule status, boundary tests, current-scan reconciliation, and repair reporting.

## M3 — Public API

### PR 13 — Core entity API

Status, Overview, Vault, Broker, and Loan list and detail endpoints with bounded pagination, filters, sorting, network, epoch, freshness, and provenance.

### PR 14 — Activity, search, and history API

Activity, transaction, search, account, epoch, object-history, and Loan-lifecycle endpoints.

### PR 15 — Exports and feeds

Bounded JSON, CSV, NDJSON, and activity-feed access.

## M4 — Baseline UI

### PR 16 — App shell, Overview, and Network Status

Responsive navigation, network and epoch context, freshness, Overview metrics, activity, status, and complete loading or error states.

### PR 17 — Vault UI

Vault list, detail, relationships, activity, and history.

### PR 18 — Loan Broker UI

Broker list and detail, debt, cover, related Vault, Loan book, and cover history.

### PR 19 — Loan UI

Loan list, detail, terms, on-ledger and schedule status, and payment schedule.

### PR 20 — Activity, transaction, search, and account UI

Activity list, transaction detail, global search, and account relationships.

## M5 — Differentiated audit UI

### PR 21 — Loan lifecycle and state changes

Lifecycle, payments, state changes, normalized before-and-after values, and raw data.

### PR 22 — Archived objects and Devnet epochs

Archived object pages, epoch selection, reset notices, and historical context.

### PR 23 — Cover and loss audit views

Cover, debt, and loss timelines with factual operational conditions.

### PR 24 — Provenance and data documentation UI

Direct, derived, indexed, and unavailable labels; formulas; API; and methodology pages.

## M6 — Hardening and public Devnet release

### PR 25 — Data integrity and reset simulation

### PR 26 — Collector runtime benchmark and guardrails

### PR 27 — Accessibility, performance, and browser coverage

### PR 28 — Public documentation and deployment

M6 completes only after the multi-day soak, resource envelope, product release gates, deployment approval, and rollback checks pass. Mainnet remains disabled until separately approved.

## Decision checkpoints

### Checkpoint A — after PR 6

Select the bootstrap and incremental collector runtimes from measured CPU, request, storage, and catch-up evidence. PR 6B implements the selected bootstrap path.

### Checkpoint B — after PR 12

Confirm that indexed history is complete enough for public lifecycle claims.

### Checkpoint C — after PR 20

Confirm baseline monitor completeness before promoting differentiated audit features.

### Checkpoint D — before public release

Confirm domain, legal and disclaimer pages, operational ownership, backup and export procedures, and release rollback.

## Mainnet follow-on milestone

Mainnet is not scheduled yet. It requires verified amendment activation, an approved starting-ledger and backfill strategy, separate configuration and capacity review, a production-shaped read soak, and explicit release approval.
