# R3B committed reader evidence — 2026-08-01

Status: R3B implementation and validation evidence for PR #1098. R3 remains local and provider-neutral.

## Delivered reader

`PortableCollectorCommittedReader` reads only committed portable rows through `PortableCollectorStorageAdapter`.

It provides:

- an immutable versioned read fence;
- latest exact lookup by semantic class and canonical key;
- deterministic semantic-class listing;
- deterministic source-ledger range listing;
- canonical relationship lookup;
- source-bound, query-bound, order-bound, fence-bound opaque cursors;
- digest verification and strict cursor shape validation;
- stable pagination while the committed fence remains unchanged.

## Read fence

Every response carries:

- source ID and portable source mode;
- network;
- epoch ID;
- base identity;
- committed ledger index and hash;
- committed work ID.

The reader verifies that the committed watermark and its work agree exactly. It fails `unavailable` before a watermark exists and `integrity_failure` when watermark or work identity is inconsistent.

## Row integrity

Before returning rows, the reader verifies:

- the row belongs to committed work;
- work and row ranges agree;
- semantic class is one of the seven normalized classes;
- ledger and transaction hashes are canonical uppercase 64-character hexadecimal identities;
- canonical key and optional object ID are non-empty;
- relationship IDs are non-empty, deduplicated, sorted, and canonical;
- non-null value JSON is valid canonical JSON;
- source network, epoch, and base identity match the reader fence.

Staged rows remain invisible because the adapter committed view is the only row source.

## Cursor contract

The cursor envelope contains version, source ID, read fence, complete query identity, order, and offset. The canonical cursor payload is SHA-256 protected.

The reader rejects:

- malformed or digest-mismatched cursors;
- cursors from another reader source;
- cursors for another query or order;
- cursors whose committed fence is no longer current;
- offsets outside the result set.

An integrity or cursor failure never falls back to a legacy reader.

## Conformance evidence

The SQLite suite proves:

1. no read fence before the first committed watermark;
2. latest exact lookup selects the newest committed version at one fence;
3. semantic pagination is deterministic across pages;
4. ledger-range and relationship queries remain source-bound;
5. tombstones retain null values and object identity;
6. staged rows never appear;
7. cursor tamper, source mismatch, query mismatch, and watermark advancement are rejected;
8. malformed committed identity fails closed;
9. invalid semantic class, bounds, and page limits are rejected.

The first CI run exposed only the TypeScript `BufferSource` boundary for Web Crypto. The reader now copies cursor bytes into a dedicated `ArrayBuffer` before hashing. Reader behavior and cursor identity did not change.

## Retained validation

CI run `30699923812` passed:

- Actions workflow-surface guard;
- lint;
- TypeScript type-check;
- production runner bundle and configuration validation;
- complete unit-test suite;
- complete clean local migration sequence, including migration `10006`;
- application build;
- browser smoke.

## Boundary

R3B exposes no public route and changes no legacy reader authority. It performs no production mutation, hosted-provider selection, Queue or Cron change, Mainnet change, recovery, qualification, or soak work.

R3C is next: strict seven-class product mappers, explicit source descriptors, `legacy_only` and `shadow_compare` selection, and deterministic bounded comparison evidence. Public responses remain legacy-authoritative.
