# Testing strategy

## Objectives

Testing must prove data correctness, collection continuity, protocol-state interpretation, asset handling, runtime and storage safety, and user-visible behavior. UI snapshots alone are not sufficient.

## Test layers

### Unit tests

Required for:

- Ripple epoch and rate-unit conversion;
- decimal-safe arithmetic;
- XRP, IOU, and MPT normalization;
- flag decoding;
- on-ledger and schedule status boundaries;
- derived formulas and provenance;
- AffectedNodes normalization;
- deletion-reason classification;
- Devnet reset signals;
- UI formatting that preserves canonical precision and identifiers;
- route and identifier validation;
- loading, empty, unavailable, stale, partial, error, archived, and invalid-route state selection;
- configured Contact and optional Support visibility rules.

### Component tests

Required for reusable UI components that own meaningful behavior, including:

- application shell and navigation;
- network context bar;
- status and provenance badges;
- metric cards;
- tables, filters, and pagination;
- long-identifier copy controls;
- archive and Devnet notices;
- loading, empty, unavailable, stale, partial, and error components;
- documentation table of contents;
- Contact option cards;
- Support panel when enabled.

Component tests verify keyboard operation, accessible names, non-color status meaning, long values, narrow layouts, and the absence of unsupported mock values.

### Fixture-based parser tests

Use redacted fixtures from validated Devnet transactions and ledger objects for every supported transaction and object type. Fixtures cover created, modified, and deleted nodes; omitted zero values; XRP, IOU, and MPT amounts; Loan payment paths; impair, unimpair, default, and delete behavior; and unknown future fields.

### Integration tests

Use local D1 migrations and fixture-ledger sequences to verify:

- idempotent reprocessing;
- cursor advancement only after success;
- rollback on partial failure;
- current projection updates;
- lifecycle ordering;
- deleted-object archival;
- asset-separated aggregates;
- network and epoch isolation;
- complete marker traversal;
- reconciliation behavior;
- API unavailable behavior before active snapshot activation;
- current/archive route resolution where applicable.

### Live Devnet smoke tests

Live tests are non-destructive reads unless a dedicated isolated protocol test is explicitly approved.

Required read checks include endpoint connection, server and amendment status, latest validated ledger, marker behavior for all object types, known current objects when available, and API serialization against live values.

Live tests must have no cross-project runtime dependency.

### API contract tests

Verify network and epoch metadata, pagination bounds, filtering, sorting, provenance, archived lookup, stale-data warnings, invalid identifiers, injection attempts, export limits, feed shape, and raw-data retention boundaries.

### Browser tests

Playwright covers:

- application shell, desktop sidebar, mobile app bar, bottom navigation, and More menu;
- persistent Devnet, epoch, ledger, freshness, and collector context;
- Overview and Network Status success, unavailable, stale, partial, and error states;
- entity lists and details;
- relationships;
- Loan on-ledger and schedule-status separation;
- activity, transaction detail, search, and account detail;
- lifecycle, archives, cover/loss, and epochs;
- About, Methodology, API documentation, and Contact;
- optional Support hidden by default and correctly configured when enabled;
- missing external Contact configuration without placeholder links;
- responsive layouts, 200% zoom, long identifiers, keyboard navigation, focus order, and browser history;
- not-found and invalid-identifier behavior;
- no unsupported USD conversion, cross-asset totals, oracle claims, mock counts, or mock operational metrics.

Visual regression images may support review but do not replace semantic and behavioral assertions.

## Data integrity invariants

1. Current objects are unique by network, epoch, and ID.
2. Loan and Broker relationships stay within the same network and epoch unless an archived reference is documented.
3. Asset aggregates include only identical canonical asset keys.
4. Deleted objects leave current projections and remain in archives.
5. Cursor gaps are rejected.
6. Reprocessing creates no duplicate canonical events.
7. `defaulted` is never derived from time alone.
8. Partial marker scans are never reported as totals.
9. Canonical amounts are not stored as binary floating point.
10. UI unavailable, stale, or indexed data is never upgraded to direct current fact.
11. Missing data is not displayed as zero.
12. Generated mockup values never enter fixtures or production UI unless independently supported by the API.

## Accessibility checks

At minimum verify:

- keyboard-only operation;
- visible focus;
- semantic landmarks and heading order;
- accessible names for copy, disclosure, external-link, navigation, and pagination controls;
- non-color status meaning;
- screen-reader announcements for loading, errors, and refreshed data where appropriate;
- WCAG AA contrast;
- 200% zoom and reflow;
- reduced-motion behavior;
- touch target size on mobile.

## External-link and Support checks

- Google Form, GitHub Issues, repository, and explorer links are configured or explicitly unavailable;
- no placeholder URL is public;
- untrusted API values do not become arbitrary links;
- public GitHub Issue privacy warning is visible;
- Support remains absent when configuration is incomplete;
- when enabled, address, network, accepted asset, destination tag, QR payload, and disclosures match approved configuration;
- Devnet monitoring and payment network are clearly distinguished;
- no wallet or signing behavior is introduced.

## Release checks

Every implementation PR runs lint, type-checking, unit and integration tests, migration checks, build checks, affected browser tests, and documentation consistency review.

A documentation-only PR verifies links, headings, route consistency, roadmap consistency, and absence of unintended code changes. CI still runs where repository workflows apply.

Before public release, run a multi-day collector soak, endpoint outage and catch-up tests, reset simulation, full marker scans, database growth measurements, API cache checks, accessibility and mobile review, external-link review, optional Support configuration review, and a rollback test.

## Test evidence

Important live, integration, API, and browser runs produce summarized results, redacted fixtures or hashes, processed ledger ranges, collector metrics, failed invariants, generated API samples, accessibility findings, and relevant screenshots. Artifacts do not replace canonical fixtures and documentation.
