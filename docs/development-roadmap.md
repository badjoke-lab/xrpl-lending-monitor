# Development roadmap

Baseline date: 2026-07-01.

This document controls implementation order, dependencies, and target schedule. It must be updated whenever a PR changes scope, slips a target window, introduces a dependency, or completes a milestone.

## Scheduling rules

- Dates are planning targets, not promises.
- Correctness and data integrity take priority over calendar targets.
- Work does not jump ahead of unmet exit criteria.
- Each implementation PR updates `docs/implementation-status.md`.
- Milestone completion is recorded here in the same PR that satisfies the exit criteria.
- UI work may prototype in parallel, but production UI cannot outrun the available canonical data model and API.

## Milestone summary

| Milestone | Target window | Goal | Exit condition |
|---|---|---|---|
| M0 Foundation and specification lock | 2026-07-01 to 2026-07-04 | Establish repository, source-of-truth docs, toolchain plan, and operating rules | Docs accepted; project skeleton PR ready |
| M1 Current-state collector | 2026-07-05 to 2026-07-12 | Connect Devnet, manage epochs, fully scan current Vault/Broker/Loan objects | Full marker-aware scan stored in local and preview D1 |
| M2 Event history and lifecycle | 2026-07-13 to 2026-07-24 | Collect validated ledgers, normalize changes, reconstruct lifecycle, preserve deletions | Deterministic replay fixtures and archive queries pass |
| M3 Public API | 2026-07-25 to 2026-07-31 | Expose complete read-only core and history APIs | Contract tests pass for all baseline entities and history |
| M4 Baseline UI | 2026-08-01 to 2026-08-12 | Deliver all normal monitoring pages and navigation | Overview, lists, details, activity, search, and status work end to end |
| M5 Differentiated audit UI | 2026-08-13 to 2026-08-20 | Add lifecycle, state changes, cover history, deleted objects, epochs, provenance | Differentiator pages complete without baseline regressions |
| M6 Hardening and public Devnet release | 2026-08-21 to 2026-08-31 | Prove integrity, free-tier safety, accessibility, and operations | Soak test and release gates pass |

The schedule must be recalibrated after M1 benchmark results, because Cloudflare Free Worker CPU viability is not yet proven.

# Detailed PR plan

## M0 — Foundation and specification lock

### PR 1 — Repository operating foundation

Target: 2026-07-01 to 2026-07-02

Scope:

- README
- AGENTS operating rules
- documentation index
- PR template
- initial decision log
- implementation status

Exit criteria:

- contributors are required to read specs and roadmap;
- every PR has a docs/status checklist;
- current phase and next PR are explicit.

### PR 2 — Product and architecture specification

Target: 2026-07-02 to 2026-07-04

Scope:

- product specification
- architecture
- data model
- status model
- asset model
- collector design
- testing strategy
- free-tier budget
- competitor positioning
- development roadmap

Exit criteria:

- no major product or data-model ambiguity blocks implementation;
- open questions are assigned to a later PR test, not left implicit.

### PR 3 — Project skeleton

Target: 2026-07-04 to 2026-07-06

Scope:

- pnpm and Node version pinning
- TypeScript
- React and Vite
- Cloudflare Worker and D1 bindings
- Hono or equivalent router
- Vitest and Playwright
- ESLint and formatting
- local, preview, and production configuration boundaries
- GitHub Actions
- Mainnet disabled by default
- initial migrations folder

Exit criteria:

- install, lint, type-check, test, build, and local Worker smoke test pass;
- no production deployment occurs;
- no Group Pay dependency exists.

## M1 — Current-state collector

### PR 4 — Network, amendment, and epoch foundation

Target: 2026-07-06 to 2026-07-08

Scope:

- endpoint configuration and fallback
- server_info and validated ledger
- amendment status
- sync_state and network_epochs migrations
- reset-signal detection skeleton
- `/api/status`

Exit criteria:

- Devnet status is stored and served;
- network and epoch are mandatory in all records;
- Mainnet mode fails closed.

### PR 5 — Asset normalization

Target: 2026-07-08 to 2026-07-09

Scope:

- XRP normalization
- IOU currency + issuer identity
- MPT issuance identity and metadata resolution
- decimal-safe amount utilities
- rate and Ripple epoch utilities

Exit criteria:

- unit and fixture tests cover all asset forms;
- unlike assets cannot be aggregated by API code.

### PR 6 — Current object scanner

Target: 2026-07-09 to 2026-07-12

Scope:

- complete marker traversal for Vault, LoanBroker, and Loan
- current tables
- relationship validation
- bootstrap scan health output
- partial-scan failure behavior
- collector CPU, request, and D1 measurement

Exit criteria:

- all pages are processed;
- counts are totals, not first-page samples;
- p50, p95, and maximum resource measurements are recorded;
- free-tier collector mode is selected or escalated.

## M2 — Event history and lifecycle

### PR 7 — Incremental validated-ledger collector

Target: 2026-07-13 to 2026-07-16

Scope:

- cursor-based ledger processing
- recognized transaction filtering
- idempotency
- bounded catch-up
- retry and failure behavior
- raw payload retention controls

Exit criteria:

- fixture sequences replay without gaps or duplicates;
- cursor advances only after successful ledger commit.

### PR 8 — AffectedNodes normalization

Target: 2026-07-16 to 2026-07-18

Scope:

- created, modified, and deleted nodes
- before/after field changes
- object ID extraction
- unknown-field logging
- transaction-to-entity relationships

Exit criteria:

- every supported transaction fixture produces deterministic normalized changes.

### PR 9 — Loan lifecycle engine

Target: 2026-07-18 to 2026-07-21

Scope:

- LoanSet creation terms
- LoanPay regular, full, and confirmed overpayment handling
- impair and unimpair
- default
- delete
- event ordering
- final-state retention

Exit criteria:

- lifecycle output reconstructs all tested Devnet paths;
- original terms are sourced from creation history, not guessed from current state.

### PR 10 — Deleted-object archive

Target: 2026-07-21 to 2026-07-22

Scope:

- Vault, Broker, and Loan deletion archival
- deletion-reason classification
- archived relationships and search aliases

Exit criteria:

- deleted objects disappear from current projections but remain searchable.

### PR 11 — Cover, debt, and loss tracking

Target: 2026-07-22 to 2026-07-24

Scope:

- CoverDeposit, Withdraw, and Clawback history
- DebtTotal history
- LossUnrealized history
- required cover formula
- cover surplus/shortfall
- asset-separated aggregates

Exit criteria:

- calculations expose source fields and formulas;
- no proprietary risk score is introduced.

### PR 12 — Status engine and reconciliation

Target: 2026-07-24 to 2026-07-25

Scope:

- on-ledger state
- schedule state
- boundary tests
- current scan versus indexed projection reconciliation
- repair reporting

Exit criteria:

- default eligibility and actual default are never conflated;
- integrity differences are visible and reproducible.

## M3 — Public API

### PR 13 — Core entity API

Target: 2026-07-25 to 2026-07-28

Endpoints:

- `/api/status`
- `/api/overview`
- `/api/vaults`
- `/api/vaults/:id`
- `/api/brokers`
- `/api/brokers/:id`
- `/api/loans`
- `/api/loans/:id`

Exit criteria:

- pagination, filters, sorting, network, epoch, freshness, and provenance are contract-tested.

### PR 14 — Activity, search, and history API

Target: 2026-07-28 to 2026-07-30

Endpoints:

- `/api/activity`
- `/api/transactions/:hash`
- `/api/search`
- `/api/accounts/:address`
- `/api/epochs`
- `/api/objects/:id/history`
- `/api/loans/:id/lifecycle`

Exit criteria:

- current and archived records are searchable;
- no unbounded query path exists.

### PR 15 — Export and feeds

Target: 2026-07-30 to 2026-07-31

Scope:

- JSON
- CSV
- NDJSON
- RSS or Atom activity feed
- export rate and size limits

Exit criteria:

- exports are documented, bounded, and asset/network/epoch aware.

## M4 — Baseline UI

### PR 16 — App shell, Overview, and Network Status

Target: 2026-08-01 to 2026-08-04

Scope:

- navigation and responsive shell
- network and epoch selector
- data freshness
- Overview metrics and asset-separated aggregates
- recent activity
- Network Status
- empty, loading, stale, and error states

Exit criteria:

- a normal user can understand current protocol state from the home page.

### PR 17 — Vault UI

Target: 2026-08-04 to 2026-08-06

Scope:

- Vault list, filters, sorting, and pagination
- Vault detail
- related Brokers and Loans
- activity and history

Exit criteria:

- all baseline Vault information is present before advanced charts.

### PR 18 — Loan Broker UI

Target: 2026-08-06 to 2026-08-08

Scope:

- Broker list and detail
- debt and cover facts
- related Vault
- Loan book
- cover history

Exit criteria:

- baseline parity with existing Broker boards plus correct formulas.

### PR 19 — Loan UI

Target: 2026-08-08 to 2026-08-10

Scope:

- Loan list and filters
- Loan detail Overview and Terms
- on-ledger and schedule status
- payment schedule

Exit criteria:

- a general user can inspect a Loan without opening raw data.

### PR 20 — Activity, transaction, search, and account UI

Target: 2026-08-10 to 2026-08-12

Scope:

- Activity list
- transaction detail
- global search
- account relationships

Exit criteria:

- every supported identifier has a user path.

## M5 — Differentiated audit UI

### PR 21 — Loan lifecycle and state changes

Target: 2026-08-13 to 2026-08-15

Scope:

- Lifecycle tab
- Payments tab
- State changes tab
- normalized before/after values
- raw-data tab

### PR 22 — Archived objects and Devnet epochs

Target: 2026-08-15 to 2026-08-17

Scope:

- archived object pages
- epoch list and selector
- reset notice and historical context

### PR 23 — Cover and loss audit views

Target: 2026-08-17 to 2026-08-19

Scope:

- cover timeline
- debt timeline
- loss timeline
- factual operational conditions

### PR 24 — Provenance and data documentation UI

Target: 2026-08-19 to 2026-08-20

Scope:

- direct/derived/indexed labels
- formula explanations
- API and methodology pages

M5 exit criteria:

- all differentiators are present without removing baseline information;
- advanced detail is progressively disclosed rather than cluttering summary views.

## M6 — Hardening and public Devnet release

### PR 25 — Data integrity and reset simulation

Target: 2026-08-21 to 2026-08-24

### PR 26 — Free-tier benchmark and guardrails

Target: 2026-08-24 to 2026-08-26

### PR 27 — Accessibility, performance, and browser coverage

Target: 2026-08-26 to 2026-08-28

### PR 28 — Public documentation and deployment

Target: 2026-08-28 to 2026-08-31

M6 exit criteria:

- multi-day soak passes;
- free-operation mode is proven;
- all product release gates in `product-spec.md` pass;
- production Devnet deployment is approved;
- Mainnet remains disabled unless separately approved.

# Decision checkpoints

## Checkpoint A — after PR 6

Decide collector runtime:

- Cloudflare Cron Worker;
- GitHub Actions collector fallback;
- lower cadence or hybrid.

Record measured evidence in `free-tier-budget.md` and `decision-log.md`.

## Checkpoint B — after PR 12

Decide whether indexed history is complete enough for public lifecycle claims.

## Checkpoint C — after PR 20

Confirm baseline monitor completeness against current competitors before promoting differentiators.

## Checkpoint D — before public release

Confirm domain, legal/disclaimer pages, operational ownership, backup/export procedure, and release rollback.

# Mainnet follow-on milestone

Mainnet is not scheduled yet.

It requires:

1. official verification that required amendments are active;
2. approved starting-ledger and backfill strategy;
3. separate Mainnet configuration and database-capacity review;
4. production collector soak on Mainnet reads;
5. explicit release approval.
