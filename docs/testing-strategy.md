# Testing strategy

## Objectives

Testing proves data correctness, collection continuity, base identity, overlay resolution, status interpretation, asset handling, bounded resource use, accessibility, discoverability, and user-visible behavior.

The project does not treat HTTP 200 responses or successful page rendering alone as sufficient proof. Release evidence is layered so ledger continuity, source events, projections, current state, lifecycle, balance history, archive state, API contracts, and UI behavior can be checked independently and then reconciled.

## Required layers

### Unit and component tests

Cover exact arithmetic, asset normalization, status boundaries, derived formulas, provenance, route validation, formatting, navigation, shared data states, tables, pagination, copy controls, documentation layout, and Contact visibility.

### Fixture and integration tests

Cover validated object and transaction shapes, created/modified/deleted nodes, terminal Loan values, idempotent replay, atomic cursor updates, lifecycle ordering, archive retention, asset-separated aggregates, network and epoch isolation, marker traversal, base identity checks, overlay upserts, deletion tombstones, reconciliation, and relationship resolution.

Required current-state cases include:

- overlay upsert overrides base;
- tombstone hides base;
- no overlay record falls back to base;
- replay creates no duplicate overlay state;
- overlay watermark never exceeds the canonical cursor;
- base identity mismatch fails closed;
- history and current overlay advance together or neither advances;
- deleted objects do not reappear through base fallback;
- base counts plus created/deleted overlay effects reconcile with resolved current counts.

### Live Devnet reads

Use bounded non-destructive reads for endpoint status, amendments, validated ledgers, marker behavior, current objects, incremental transaction shapes, and public serialization. Live evidence must not introduce a cross-project runtime dependency.

### Complete base tests

Cover:

- fixed validated ledger identity;
- exact marker resume;
- complete traversal termination;
- deterministic artifact and manifest digests;
- record count verification;
- relationship verification;
- read-model page and lookup generation;
- immutable publication ordering;
- active channel identity;
- previous-base preservation when replacement fails.

### Incremental continuation tests

Cover:

- cursor starts from base ledger plus one;
- bounded contiguous ledger selection;
- parent-hash continuity;
- interrupted run resume;
- replay and retry idempotency;
- current overlay mutation;
- deletion tombstone creation;
- lifecycle, archive, balance, and current-state consistency;
- catch-up across multiple runs;
- stale state while behind;
- reset detection and epoch separation.

### Permanent runtime monitoring

Post-cutover runtime monitoring remains active after the collector reaches the validated head.

The lightweight monitoring layer runs every 30 minutes and checks collector status, cursor, observed head, lag, runtime usage, failures, current error, replacement-base binding, hybrid-history source state, and actual D1 daily usage.

The deep semantic layer runs every 6 hours subject to the D1 read guard and checks HYB-7 source/projection evidence, processed-ledger continuity, created/modified/deleted object changes, overlay/tombstone agreement, LoanPay and LoanManage activity, impairment/unimpairment/default transitions, lifecycle, archive, balance source/history, linkage gaps, and M1 gate states.

A missing live path remains `missing`; contradictory evidence is `inconsistent`; only source-plus-projection agreement can become `observed`. Monitoring must not synthesize evidence, weaken resource guards, or mutate collector, D1, XRPL, or deployment state.

### API contract tests

Cover metadata, active base identity, overlay watermark, collector cursor, bounded pagination, filters, sorting, provenance, asset-safe values, base-plus-overlay relationships, stale and unavailable states, archived lookup, malformed identifiers, exports, feeds, and retention boundaries.

### Production behavior smoke

Run a bounded production behavior smoke after important deployments and as part of M5-5 real-data integration. It is lower-frequency than permanent runtime monitoring and must remain D1-aware.

Representative coverage includes:

- Overview;
- Vault list to valid Vault detail;
- Loan Broker list to valid Broker detail;
- Loan list to valid Loan detail;
- Activity;
- Lifecycle;
- Archived Objects;
- Cover & Loss;
- Search;
- Network Status.

The smoke must verify more than route availability. It must check representative live relationships and state consistency, including where applicable:

- `Loan.loan_broker_id` matches the related Loan Broker identifier;
- the related Loan Broker `vault_id` matches the related Vault identifier;
- current objects are not simultaneously presented as archived;
- archived or deleted objects do not reappear through current base fallback;
- current state agrees with the latest relevant indexed historical transition;
- lifecycle state agrees with current-object state where the protocol semantics require agreement;
- freshness and lag claims match the collector status source.

The production behavior smoke must use bounded read-only requests, discovered live identifiers, explicit timeouts, and clear failure evidence. It must not run at the 30-minute permanent-monitor cadence.

### Browser tests

Cover desktop and mobile navigation, network context, Overview, Network Status, Vaults, Loan Brokers, Loans, Activity, Search, project pages, entity relationships, separate Loan state models, all shared data states, long identifiers, keyboard operation, focus order, browser history, zoom, and invalid routes.

The browser suite must also prove that unsupported fiat values, cross-asset totals, oracle claims, invented counts, promotional controls, and write-capable controls are absent.

A manual release visual-audit workflow must capture full-page screenshots from the deployed read-only site at minimum for representative desktop and narrow-mobile viewports. The route matrix includes Overview, Vaults, one valid Vault detail, Loan Brokers, one valid Broker detail, Loans, one valid Loan detail, Activity, Lifecycle, Archived Objects, Cover & Loss, Search, Network Status, API, Methodology, About, Contact, and the mobile More menu open state. Detail identifiers must be discovered from live read-only APIs rather than hard-coded stale fixtures. Screenshot evidence supplements, but does not replace, semantic browser assertions.

Before capture, the audit must wait for visible main content, completed loading states, best-effort network idle, and web-font readiness. The artifact must include the route/profile/detail-ID manifest and technical diagnostics for page-level horizontal overflow, candidate overflowing elements, browser console errors, page errors, and HTTP error responses.

Live current-state browser regression must verify that:

- a base-only object renders correctly;
- an overlay-updated object renders the overlay state;
- a tombstoned object is absent from current routes;
- archived context remains available where collected;
- freshness and lag are visible and accurate.

## Integrity invariants

1. Current objects are unique by network, epoch, active base identity, type, and ID.
2. Current relationships remain inside one network, epoch, and active base-plus-overlay context.
3. Unlike assets are never aggregated.
4. Deleted objects leave current projections and remain archived where collected.
5. Cursor gaps and parent-hash discontinuities fail closed.
6. Replay creates no duplicate canonical events or conflicting overlay state.
7. Time alone never changes an on-ledger Loan state.
8. Partial scans are never reported as complete totals.
9. Missing data is never displayed as zero.
10. Mockup values never become facts without API support.
11. Overlay watermark never exceeds the canonical cursor.
12. Tombstones suppress base fallback.
13. Base identity mismatch never falls back silently.
14. Stale or interrupted continuation is never labeled fresh.
15. A successful route response does not override contradictory source, projection, lifecycle, balance, archive, or relationship evidence.

## Accessibility and external links

Verify keyboard use, visible focus, semantics, accessible names, non-color status meaning, announcements, contrast, reflow, reduced motion, mobile touch targets, configured Contact links, and absence of placeholder destinations.

## Release checks

Every implementation pull request runs applicable lint, type, unit, integration, migration, build, and browser checks. Documentation-only changes verify headings, links, routes, roadmap consistency, authority consistency, and absence of unintended code changes.

Before public release, complete:

- complete base verification;
- permanent lightweight and deep monitoring continuity;
- incremental collector soak;
- outage recovery;
- catch-up tests;
- reset simulation;
- marker traversal evidence;
- D1 growth and overlay measurements;
- reconciliation;
- base replacement review;
- M1 readiness-enforced exit review;
- M5-5 real-data cross-audit integration;
- bounded production behavior smoke;
- cache review where caching is used;
- accessibility review;
- full-page desktop/mobile visual audit, technical diagnostic review, and remediation re-audit;
- route metadata, canonical, robots, sitemap, social metadata, and structured-data validation;
- external-link review;
- recovery procedure review;
- real multi-day soak;
- final release verification.

## Evidence

Record summarized test results, bounded live evidence, processed ledger ranges, base identity, overlay watermark, resource measurements, failures, API samples, production behavior-smoke findings, accessibility findings, representative full-page screenshots, visual-audit diagnostics, visual-audit findings and fixes, and discoverability validation results in the pull request and implementation status.