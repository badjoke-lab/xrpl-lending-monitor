# Data model

## Canonical domains

The DB-less migration does not change XRPL Lending domain semantics.

Current objects:

- Vault
- LoanBroker
- Loan

Historical records:

- protocol event;
- normalized object change;
- Loan lifecycle event;
- archived deleted object;
- balance/cover/loss history;
- ledger continuity record.

## Current projection model

Current projection types remain defined in code under `src/domain/lending/current-projections.ts`.

A logical Current object is resolved as:

```text
base object
+ later live upsert(s)
- later deletion tombstone
= current object or absent
```

A deletion removes an object from Current but does not erase collected historical evidence.

## Artifact identities

Every artifact belongs to:

- schema version;
- network;
- epoch;
- generation;
- ledger boundary.

Every immutable artifact has a SHA-256 digest in its manifest.

## Current base manifest

Required fields include:

- schemaVersion;
- network;
- epochId;
- generationId;
- snapshotId;
- ledgerIndex;
- ledgerHash;
- complete;
- per-kind counts;
- shard/index descriptors;
- artifact digests;
- generatedAt;
- source revision.

A base with `complete != true` is never public Current.

## Live delta manifest

Required fields include:

- schemaVersion;
- network;
- epochId;
- generationId;
- baseSnapshotId;
- startLedgerIndex;
- startParentHash;
- endLedgerIndex;
- endLedgerHash;
- ledgerCount;
- mutationCount;
- history record counts;
- artifact digests;
- generatedAt;
- source revision.

## Mutation record

A Current mutation is either:

- `upsert`: complete normalized projection for one Vault/LoanBroker/Loan;
- `deleted`: object type, object ID, ledger/transaction identity, and retained relationship keys where available.

Within one run, repeated mutations for one object may be coalesced for Current only. Historical changes are never removed by Current coalescing.

## History records

History preserves existing normalized semantics:

- transaction hash;
- ledger index/hash context;
- transaction index/event index;
- close time;
- transaction type/result;
- object type/object ID;
- action;
- before/after field values;
- relationships;
- lifecycle classification;
- archived final state;
- balance-series values and formula provenance.

## Channel model

The public channel is a small mutable pointer to immutable generations.

It must identify:

- active base;
- active compacted overlay/live generation;
- last committed Current ledger/hash;
- history coverage ranges;
- latest history ledger/hash;
- generation digests;
- updatedAt.

Coverage ranges are explicit arrays, not one inferred continuous span.

## Provenance

Public data retains the categories:

- `direct`: decoded from verified Current ledger object;
- `derived`: deterministic calculation from direct fields;
- `indexed`: derived from collected validated historical transactions;
- `unavailable`: not supported, not collected, stale beyond a contract, or failed verification.

## No database schema

SQL table layout is no longer part of the canonical data model.

Legacy SQL schemas may remain temporarily in code during migration but cannot define new public semantics.
