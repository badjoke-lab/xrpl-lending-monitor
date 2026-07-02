# Testing strategy

## Objectives

Testing proves data correctness, collection continuity, status interpretation, asset handling, bounded resource use, accessibility, and user-visible behavior.

## Required layers

### Unit and component tests

Cover exact arithmetic, asset normalization, status boundaries, derived formulas, provenance, route validation, formatting, navigation, shared data states, tables, pagination, copy controls, documentation layout, and Contact visibility.

### Fixture and integration tests

Cover validated object and transaction shapes, created/modified/deleted nodes, terminal Loan values, idempotent replay, atomic cursor updates, lifecycle ordering, archive retention, asset-separated aggregates, network and epoch isolation, marker traversal, reconciliation, and same-snapshot relationships.

### Live Devnet reads

Use bounded non-destructive reads for endpoint status, amendments, validated ledgers, marker behavior, current objects, and public serialization. Live evidence must not introduce a cross-project runtime dependency.

### API contract tests

Cover metadata, active snapshot identity, bounded pagination, filters, sorting, provenance, asset-safe values, same-snapshot relationships, stale and unavailable states, archived lookup, malformed identifiers, exports, feeds, and retention boundaries.

### Browser tests

Cover desktop and mobile navigation, network context, Overview, Network Status, Vaults, Loan Brokers, Loans, Activity, Search, project pages, entity relationships, separate Loan state models, all shared data states, long identifiers, keyboard operation, focus order, browser history, zoom, and invalid routes.

The browser suite must also prove that unsupported fiat values, cross-asset totals, oracle claims, invented counts, promotional controls, and write-capable controls are absent.

## Integrity invariants

1. Current objects are unique by network, epoch, and ID.
2. Current relationships remain inside one active snapshot, network, and epoch.
3. Unlike assets are never aggregated.
4. Deleted objects leave current projections and remain archived.
5. Cursor gaps and inconsistent relationships fail closed.
6. Replay creates no duplicate canonical events.
7. Time alone never changes an on-ledger Loan state.
8. Partial scans are never reported as complete totals.
9. Missing data is never displayed as zero.
10. Mockup values never become facts without API support.

## Accessibility and external links

Verify keyboard use, visible focus, semantics, accessible names, non-color status meaning, announcements, contrast, reflow, reduced motion, mobile touch targets, configured Contact links, and absence of placeholder destinations.

## Release checks

Every implementation pull request runs applicable lint, type, unit, integration, migration, build, and browser checks. Documentation-only changes verify headings, links, routes, roadmap consistency, and absence of unintended code changes.

Before public release, complete the collector soak, outage recovery, reset simulation, marker traversal, storage measurements, cache review, accessibility review, external-link review, and rollback test.

## Evidence

Record summarized test results, bounded live evidence, processed ledger ranges, resource measurements, failures, API samples, accessibility findings, and relevant screenshots in the pull request and implementation status.