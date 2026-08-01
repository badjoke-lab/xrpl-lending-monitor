# R3C product mapper and shadow evidence — 2026-08-01

Status: R3C implementation and validation evidence for PR #1099. R3 remains local and provider-neutral.

## Seven strict product mappers

The portable product mapper surface provides one explicit versioned mapping for each normalized semantic class:

- `validated-ledger` -> validated ledger product;
- `protocol-event` -> protocol event product;
- `object-change` -> object change product;
- `loan-lifecycle` -> loan lifecycle product;
- `archived-object` -> archived object product;
- `balance-history` -> balance history product;
- `current-projection` -> present or deleted current projection product.

Every mapped record retains complete portable provenance:

- work ID;
- semantic class and canonical key;
- source ledger index and hash;
- source transaction hash;
- object ID;
- canonical relationship IDs;
- tombstone state;
- creation time.

## Identity and value checks

The mappers fail closed when:

- the row semantic class does not match the selected mapper;
- required transaction or object identity is missing;
- a ledger value disagrees with the row ledger identity;
- an object or loan value disagrees with the row object identity;
- a current projection ID, previous transaction, or previous ledger disagrees with row provenance;
- a required value is absent;
- value JSON is invalid or non-canonical;
- an enum-like action or projection kind is unknown;
- a current projection tombstone contains a non-null value.

A deleted current projection produces an explicit deleted product with `projection: null`; it does not invent an object state.

## Legacy-authoritative compatibility modes

R3C implements only:

1. `legacy_only`
   - invokes the legacy read and returns the legacy response;
   - does not invoke the portable reader;
   - produces no shadow evidence.
2. `shadow_compare`
   - invokes the legacy read first;
   - keeps the legacy response as the only response authority;
   - normalizes a bounded legacy record set;
   - obtains a separately fenced portable snapshot;
   - compares canonical ordered records outside the response;
   - returns only comparison evidence beside the unchanged legacy response.

No portable-primary or portable-only mode is implemented.

## Shadow evidence

The evidence envelope records:

- legacy and portable source IDs;
- portable read fence when available;
- legacy and portable record counts;
- canonical SHA-256 record digests;
- first mismatch index;
- portable reader or mapper error classification;
- bounded-skip status when either record set exceeds the configured limit.

Statuses are:

- `match`;
- `mismatch`;
- `portable_error`;
- `skipped_limit`.

A portable integrity or mapping failure is recorded as evidence. It is never converted into a match and never changes the legacy response.

## Conformance evidence

The mapper suite proves:

- successful mapping of all seven semantic classes;
- complete provenance retention;
- present and deleted current projection behavior;
- transaction, object, ledger, class, and canonical-value mismatch rejection.

The compatibility suite proves:

- `legacy_only` never invokes the portable reader;
- matching portable records produce deterministic equal digests;
- mismatches retain legacy authority and identify the first differing record;
- portable errors are recorded without changing the legacy response;
- oversized legacy pages skip before portable execution;
- invalid shadow configuration and failed legacy normalization are rejected.

## Retained validation

CI run `30700338086` passed:

- Actions workflow-surface guard;
- lint;
- TypeScript type-check;
- production runner bundle and configuration validation;
- complete unit-test suite;
- complete clean local migration sequence, including migration `10006`;
- application build;
- browser smoke.

## Boundary

R3C adds no public route and changes no public reader authority. It implements no portable-primary fallback, hosted adapter, remote write, provider selection, Queue or Cron change, Mainnet change, recovery, qualification, or soak work.

R3D is next: deterministic committed-only publication candidates, independent verification, publication-watermark advancement after verification only, and bounded maintenance authorization after verified publication. R3D performs no remote write.
