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
- Devnet reset signals.

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
- reconciliation behavior.

### Live Devnet smoke tests

Live tests are non-destructive reads unless a dedicated isolated protocol test is explicitly approved.

Required read checks include endpoint connection, server and amendment status, latest validated ledger, marker behavior for all object types, known current objects when available, and API serialization against live values.

Live tests must have no cross-project runtime dependency.

### API contract tests

Verify network and epoch metadata, pagination bounds, filtering, sorting, provenance, archived lookup, stale-data warnings, invalid identifiers, injection attempts, and raw-data retention boundaries.

### Browser tests

Playwright covers Overview states, entity lists and details, relationships, Loan status separation, activity, search, archived epochs, deleted objects, error states, and responsive layouts.

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

## Release checks

Every implementation PR runs lint, type-checking, unit and integration tests, migration checks, build checks, affected browser tests, and documentation consistency review.

Before public release, run a multi-day collector soak, endpoint outage and catch-up tests, reset simulation, full marker scans, database growth measurements, API cache checks, accessibility and mobile review, and a rollback test.

## Test evidence

Important live and integration runs produce summarized results, redacted fixtures or hashes, processed ledger ranges, collector metrics, failed invariants, generated API samples, and relevant screenshots. Artifacts do not replace canonical fixtures and documentation.
