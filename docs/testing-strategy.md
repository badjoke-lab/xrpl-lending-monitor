# Testing strategy

## Objectives

Testing must prove data correctness, collection continuity, protocol-state interpretation, asset handling, free-tier safety, and user-visible behavior. UI snapshots alone are not sufficient.

## Test layers

### Unit tests

Required for:

- Ripple epoch conversion;
- rate-unit conversion;
- decimal-safe arithmetic;
- XRP, IOU, and MPT normalization;
- flag decoding;
- on-ledger status;
- schedule status and exact boundary times;
- derived formulas;
- AffectedNodes normalization;
- deletion-reason classification;
- provenance assignment;
- Devnet reset signals.

### Fixture-based parser tests

Store redacted fixtures from validated Devnet transactions and ledger objects for every supported transaction type and object type.

Fixtures must include:

- created, modified, and deleted nodes;
- zero-value fields that may be omitted;
- XRP, IOU, and MPT amounts;
- private Vaults and Domain IDs;
- regular and full LoanPay;
- overpayment evidence when confirmed;
- impair, unimpair, and default;
- deleted Loan, Broker, and Vault records;
- unknown future fields.

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
- marker completion;
- reconciliation behavior.

### Live Devnet smoke tests

Live tests are non-destructive reads unless a dedicated, isolated protocol test is explicitly approved.

Required read smoke tests:

- endpoint connection;
- server info and amendment state;
- latest validated ledger;
- first page and marker behavior for all object types;
- one known current object when available;
- API serialization against live values.

Live tests must not depend on Group Pay or any other repository.

### API contract tests

Verify:

- network and epoch metadata in all responses;
- pagination bounds;
- filtering and sorting;
- direct, derived, and indexed provenance;
- archived object lookup;
- stale-data warnings;
- invalid identifiers and injection attempts;
- raw-data retention boundaries.

### Browser tests

Playwright must cover:

- Overview loading and stale state;
- Vault, Broker, and Loan list navigation;
- detail relationships;
- Loan status separation;
- activity and transaction changes;
- search by supported identifier types;
- archived epoch and deleted object views;
- empty, loading, partial, and error states;
- responsive layouts.

## Data integrity invariants

The test suite must enforce:

1. Current objects are unique by network, epoch, and ID.
2. A Loan references one Broker in the same network and epoch, or a documented archived reference.
3. A Broker references one Vault in the same network and epoch, or a documented archived reference.
4. Asset aggregates include only identical asset keys.
5. A deleted object is absent from current projections and present in archives.
6. Cursor gaps are rejected.
7. Reprocessing produces no duplicate canonical events.
8. `defaulted` is never derived from time alone.
9. Partial marker scans are never reported as totals.
10. Canonical amounts are not stored as binary floating point.

## Release checks

Every PR:

- lint;
- type-check;
- unit and integration tests;
- migration apply on an empty local D1;
- migration apply from the previous schema;
- build;
- affected Playwright smoke tests;
- documentation consistency checklist.

Before public release:

- multi-day collector soak test;
- forced endpoint outage and catch-up test;
- simulated Devnet reset;
- full marker scan;
- database size and write-rate measurement;
- API cache behavior;
- accessibility and mobile review;
- production rollback test.

## Test evidence

Important live and integration test runs should produce artifacts containing:

- summarized results;
- redacted fixtures or hashes;
- processed ledger range;
- collector metrics;
- failed invariants;
- generated API samples;
- relevant screenshots.

Artifacts do not replace canonical repository fixtures and documentation.
