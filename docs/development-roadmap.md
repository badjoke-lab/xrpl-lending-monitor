# Development roadmap

Baseline date: 2026-07-01.
Recalibrated after M3 completion and UI architecture approval: 2026-07-02.

This document controls implementation order, dependencies, and target windows. Dates are planning targets rather than promises. Correctness, data integrity, accessibility, and release gates take priority over calendar targets.

Roadmap unit labels such as `M4-1` are planning identifiers, not guaranteed GitHub pull-request numbers. Each unit should normally be one focused pull request unless evidence justifies a smaller split.

## Milestone summary

| Milestone | Current status | Recalibrated target window | Goal | Exit condition |
|---|---|---|---|---|
| M0 Foundation and specification lock | Complete | 2026-07-01 | Establish repository, source-of-truth documents, toolchain, and operating rules | Documentation accepted and project skeleton ready |
| M1 Current-state collector | Code foundation complete; isolated full bootstrap and activation remain | 2026-07-02 to 2026-07-08, external access permitting | Connect Devnet, manage epochs, scan current objects, and create the first active snapshot | Complete marker-aware current-state bootstrap stored, verified, and activated |
| M2 Event history and lifecycle | Complete through Checkpoint B | Completed 2026-07-02 | Collect validated ledgers, normalize changes, reconstruct lifecycle, and preserve deletions | Deterministic replay, archive, status, and reconciliation work merged |
| M3 Public API | Complete through exports and feeds | Completed 2026-07-02 | Expose bounded read-only core and history APIs | Contract tests pass for baseline entities, history, exports, and feeds |
| M4 Baseline UI and project pages | UI architecture approved; implementation WIP checkpoint not merge-ready | 2026-07-02 to 2026-07-10 | Deliver the ordinary monitor, project pages, navigation, responsive behavior, and shared UI states | Required baseline routes work end to end and Checkpoint C passes |
| M5 Differentiated audit UI | Not started | 2026-07-10 to 2026-07-16 | Add lifecycle, state changes, archives, cover/loss, epochs, and provenance integration | Audit views complete without baseline regressions |
| M6 Hardening and public Devnet release | Not started | 2026-07-16 to 2026-07-26 | Prove integrity, resource safety, accessibility, operations, and deployment readiness | Multi-day soak and all release gates pass |

The original August target remains a conservative outer boundary. The recalibrated dates reflect the actual M2 and M3 completion state, but external preview access, bootstrap runtime, review, deployment approval, and soak evidence may extend the release date.

The schedule was previously recalibrated after the current-object scanner benchmark. Full bootstrap remains separated from the scheduled Worker because measured global marker traversal does not fit a normal scheduled invocation.

## Cross-cutting rules

- M1 preview bootstrap closeout may proceed in parallel with independent M4 and M5 work, but current-state pages must show explicit unavailable states until an active snapshot exists.
- No UI page may invent values to appear complete.
- No Mainnet, wallet, signing, transaction submission, remote infrastructure, deployment, or production bootstrap action is authorized by this roadmap alone.
- About, Methodology, Contact, and API documentation are required baseline project pages.
- Support is optional, disabled by default, and may be enabled only after address, network, accepted asset, destination-tag rule, QR payload, disclosure text, and operational ownership are approved.
- Generated UI mockups are visual references only; approved API and specification documents control displayed data.

## M0 — Foundation and specification lock

Completed scope:

- repository operating foundation;
- product and architecture specifications;
- data, status, asset, collector, testing, resource, competitor, and roadmap documents;
- pinned Node, pnpm, TypeScript, React, Vite, Worker, D1, Hono, Vitest, Playwright, ESLint, and CI setup;
- local, preview, and production boundaries;
- Mainnet fail-closed configuration.

## M1 — Current-state collector

### Completed foundation

- network, amendment, epoch, reset, and synchronization state;
- canonical XRP, IOU, and MPT normalization;
- current object scanner and benchmark;
- complete marker traversal primitives;
- resumable exact-marker batches;
- current projections and relationship checks;
- terminal Loan zero-omission handling;
- long-running bootstrap runner;
- deterministic compressed shards;
- external storage adapter;
- complete manifest verification contract;
- D1 snapshot metadata and active-pointer activation contract;
- controlled two-batch live interruption and resume preview.

### M1-closeout-1 — Preview environment plan and bindings

- isolated preview Worker configuration;
- isolated preview D1;
- isolated bootstrap object-storage path or bucket;
- environment-specific IDs and bindings;
- remote migration, rollback, cleanup, and access documentation;
- no production or Mainnet configuration.

This unit stops at the human approval gate before resource creation or remote mutation if access has not been approved.

### M1-closeout-2 — Complete preview bootstrap and activation

- fix one validated Devnet ledger index and hash;
- complete all markers;
- persist exact continuation only after durable shard writes;
- verify every shard and complete manifest;
- demonstrate interruption, resume, retry, cleanup, activation, and rollback;
- record requests, runtime, memory, bytes, object counts, and recovery behavior;
- activate only the verified complete snapshot;
- preserve the prior active pointer after failure.

M1 exits only when a complete marker-aware bootstrap is stored, verified, and active.

## M2 — Event history and lifecycle

Completed in dependency order:

1. incremental validated-ledger collector;
2. AffectedNodes normalization;
3. Loan lifecycle engine;
4. deleted-object archive;
5. cover, debt, and loss tracking;
6. status engine and reconciliation;
7. Checkpoint B history-completeness decision.

Public lifecycle completeness claims remain bounded by the evidence recorded at Checkpoint B and later soak/reconciliation results.

## M3 — Public API

Completed units:

1. core entity API shell;
2. activity, search, and history API;
3. bounded exports and feeds.

Current-entity collections must continue to return explicit unavailable states until an active snapshot and public object-shard reader are available.

## M4 — Baseline UI and project pages

M4 begins with documentation and design alignment. UI code must not resume from the WIP checkpoint until M4-0 is merged.

### M4-0 — UI specification and route architecture

Documentation-only unit:

- canonical site map and routes;
- Monitor, Audit, System, and Project navigation groups;
- desktop sidebar and mobile navigation model;
- page responsibilities and API dependencies;
- dark ledger-observatory visual system;
- reusable component contracts;
- loading, empty, unavailable, stale, partial, error, archived, and invalid-route states;
- responsive and accessibility rules;
- mockup interpretation and prohibited invented data;
- About, Methodology, Contact, API, and optional Support specifications;
- roadmap, product, architecture, Codex, index, decision, and implementation-status alignment.

Exit condition: all source-of-truth documents agree and no UI code is included.

### M4-1 — App shell, Overview, and Network Status

- reconcile the `ui/overview-status-shell` WIP checkpoint after M4-0 merges;
- dark design tokens;
- desktop sidebar;
- mobile app bar, bottom navigation, and More menu;
- persistent Devnet, epoch, validated-ledger, freshness, and collector context;
- Overview metrics using only API-supported values;
- active-snapshot unavailable state;
- network and collector health;
- amendment status;
- recent activity preview;
- Devnet reset and epoch notice;
- provenance legend;
- Network Status page;
- shared loading, empty, unavailable, stale, partial, error, not-found, and invalid-identifier components;
- focused component and browser tests.

Exit condition: the WIP light shell is replaced, all checks pass, and the approved desktop and mobile direction is demonstrated without invented data.

### M4-2 — Vault UI

- Vault list;
- bounded search, filters, sorting, and pagination;
- Vault detail;
- current fields, flags, asset identity, Share MPT, Domain, utilization, and used assets;
- connected Loan Brokers and Loans;
- activity and history;
- archive cross-link;
- responsive table and detail behavior.

### M4-3 — Loan Broker UI

- Loan Broker list and detail;
- related Vault;
- Loan book;
- DebtTotal, DebtMaximum, debt utilization;
- CoverAvailable, configured cover rates, required minimum cover, and surplus or shortfall;
- activity and history;
- archive cross-link;
- asset-safe responsive presentation.

### M4-4 — Loan UI

- Loan list and detail;
- bounded filters and pagination;
- terms and current balances;
- separate on-ledger and schedule states;
- payment schedule;
- related Broker and Vault;
- archive lookup;
- core Overview, Terms, and Payments tabs;
- mobile Loan detail.

Full lifecycle, state-change, and archive audit integration remains M5 work.

### M4-5 — Activity, Transaction, Search, and Account UI

- Activity list and filters;
- transaction detail;
- affected nodes and normalized changes;
- global search;
- Account relationships;
- export and feed links;
- responsive activity cards or priority-column tables;
- malformed-identifier and no-result states.

### M4-6 — Project and data documentation pages

Required pages:

- About;
- Methodology;
- Contact;
- API documentation.

Required behavior:

- documentation layout and stable anchors;
- full Methodology table of contents;
- Google Form and GitHub Issues contact choices using configured URLs only;
- public-issue privacy warning;
- About purpose, scope, independence, read-only status, non-goals, repository, Methodology, and Contact links;
- optional `/about#support` section and navigation only after explicit support configuration approval;
- no placeholder external links.

### M4-7 — Baseline integration, accessibility, and Checkpoint C

- cross-page navigation and breadcrumbs;
- current versus archived relationship links;
- browser-history and deep-link verification;
- responsive completion across all M4 routes;
- keyboard, focus, semantics, contrast, zoom, and long-identifier coverage;
- shared state consistency;
- no unsupported USD, pricing, cross-asset total, or risk-score output;
- end-to-end baseline monitor review.

Exit condition: Checkpoint C confirms ordinary monitor completeness before audit-only promotion.

## M5 — Differentiated audit UI

### M5-1 — Loan lifecycle and state changes

- protocol-wide lifecycle explorer;
- Loan lifecycle and payment timeline;
- impair, unimpair, default, repay, and delete events;
- normalized before-and-after state changes;
- source transactions;
- raw data where retained;
- no unsupported intermediate-state inference.

### M5-2 — Archived objects and final-state audit

- Archived Objects explorer;
- archived Vault, Loan Broker, and Loan detail pages;
- final state;
- deletion event and classification;
- archive metadata and provenance;
- source transactions and raw archive data;
- current/archive and epoch cross-links.

### M5-3 — Cover, debt, and loss audit

- asset-separated DebtTotal, DebtMaximum, CoverAvailable, and LossUnrealized histories;
- cover events;
- required minimum cover formula and inputs;
- cover surplus or shortfall;
- Broker and Vault context;
- source events and provenance;
- no cross-asset or fiat aggregation.

### M5-4 — Devnet epochs and provenance integration

- epoch list and detail;
- reset boundaries;
- epoch-scoped objects, activity, and archives;
- Direct, Derived, Indexed, and Unavailable inspection;
- formula links;
- Methodology and API cross-links.

### M5-5 — Audit navigation, exports, and regression completion

- cross-audit navigation;
- audit exports where supported by bounded API contracts;
- current, history, archive, and epoch consistency;
- mobile audit layouts;
- accessibility and browser regression coverage;
- baseline M4 regression verification.

## M6 — Hardening and public Devnet release

### M6-1 — Data integrity and reset simulation

Prove:

- Devnet reset creates a new epoch;
- old epochs remain intact;
- cursor gaps and hash discontinuities are rejected;
- current and archive projections reconcile;
- failed snapshot replacement rolls back safely;
- duplicate processing does not duplicate canonical data.

### M6-2 — Collector runtime benchmark and guardrails

Measure and document:

- runtime distribution;
- request count;
- D1 reads and writes;
- storage and shard growth;
- controlled catch-up;
- endpoint outage and recovery;
- retry and backoff behavior;
- stale-data behavior;
- bounded scheduling behavior.

Activate the approved resource-envelope guardrails.

### M6-3 — Accessibility, performance, security, and browser coverage

- keyboard and screen-reader review;
- focus, semantics, contrast, zoom, responsive behavior, table usability, and long identifiers;
- supported browser matrix;
- performance budgets;
- input and identifier validation;
- cache and abuse controls;
- no secret or internal-error exposure.

### M6-4 — Public documentation and deployment preparation

- final About, Methodology, Contact, API, provenance, and limitation content;
- legal and disclaimer review;
- operational runbook;
- backup and export procedure;
- rollback procedure;
- domain and deployment plan;
- support configuration review if support is enabled.

External forms, support address, domain, deployment, and production-resource changes remain human approval gates.

### M6-5 — Multi-day soak and public release

- production-shaped Devnet collector soak;
- repeated scheduled runs;
- lag and resource evidence;
- reset and recovery evidence where available;
- active snapshot and history consistency;
- public UI/API verification;
- deployment approval;
- rollback readiness;
- release report.

M6 completes only after the multi-day soak, resource envelope, product release gates, deployment approval, and rollback checks pass. Mainnet remains disabled until separately approved.

## Decision checkpoints

### Checkpoint A — collector runtime

Completed. The full bootstrap uses a resumable long-running runner and bounded compressed shards rather than a scheduled Worker global scan.

### Checkpoint B — history completeness

Completed as a bounded decision. Public claims remain limited by recorded evidence and later soak/reconciliation.

### UI architecture gate — before M4 code resumes

M4-0 documentation must be merged. The generated mockups are layout references only. The current light WIP checkpoint is not merge-ready.

### Checkpoint C — after M4-7

Confirm baseline monitor completeness, project-page completeness, navigation, responsive behavior, accessibility, and absence of invented data before promoting M5 audit-only features.

### Checkpoint D — before public release

Confirm domain, final legal and disclaimer text, Contact configuration, optional Support configuration, operational ownership, backup and export procedures, deployment plan, and rollback.

## Mainnet follow-on milestone

Mainnet is not scheduled. It requires verified amendment activation, an approved starting-ledger and backfill strategy, separate configuration and capacity review, a production-shaped read soak, and explicit release approval.
