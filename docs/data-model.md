# Data model

## Global keys

Every canonical record includes network, epoch, ledger identity, source transaction where applicable, and UTC timestamps. Queries do not join networks or epochs without an explicit aggregate layer.

Current-state records additionally carry or resolve the active base snapshot identity and the highest contiguous overlay ledger reflected in the result.

## Provenance

User-facing fields are labeled `direct`, `derived`, `indexed`, or `unavailable`. Derived fields expose a formula identifier. Indexed fields expose historical source references where practical.

## Current-state model

The accepted current-state model uses:

1. one complete verified immutable base read model fixed to a validated ledger; and
2. bounded D1 current-state overlay records for canonical changes after the base ledger.

### Base read model

The base manifest records:

- snapshot ID;
- network and epoch;
- fixed ledger index and hash;
- Vault, Loan Broker, and Loan counts;
- page size and page counts;
- lookup partition parameters;
- manifest digest;
- complete verification state.

The published base contains bounded list pages and exact lookup structures required for current entity reads. The base is immutable after publication.

### D1 current-state overlay

D1 stores only post-base current-state changes needed to resolve the latest state.

Each overlay upsert stores:

- network;
- epoch;
- base snapshot ID;
- object type;
- object ID;
- canonical current projection JSON;
- source ledger index and hash;
- source transaction hash;
- relevant relationship and search keys;
- update timestamp.

Each deletion tombstone stores:

- network;
- epoch;
- base snapshot ID;
- object type;
- object ID;
- deletion ledger index and hash;
- deletion transaction hash;
- deletion timestamp.

### Current read precedence

For one network, epoch, and active base:

1. an overlay upsert overrides the base object;
2. a deletion tombstone hides the base object from current routes;
3. absence of an overlay record falls back to the base object.

### Overlay watermark

The overlay watermark records the highest contiguous validated ledger reflected in current overlay state.

The overlay watermark must never exceed the canonical incremental cursor.

## Core D1 tables

### `network_epochs`

Tracks continuous ledger history segments, first and last ledger identities, status, timestamps, and reset reason.

### `sync_state`

Tracks the current epoch, incremental cursor, latest observed ledger, active base identity where required, attempts, success time, status, endpoint, and public-safe error state.

### `processed_ledgers`

Records committed validated ledger identity, ordering, close time, parent continuity, transaction count, and processing metadata.

### `protocol_events`

Stores canonical Lending-related transaction events keyed by network, epoch, ledger, transaction order, and transaction hash.

### `incremental_commit_guards`

Transient rows used inside an incremental D1 batch. A constraint mismatch aborts the batch before canonical incremental persistence can advance.

### `object_changes`

Stores normalized AffectedNodes changes with transaction, ledger, object, action, field, before, after, value type, unsupported-field flag, and directly supported relationships.

### Current overlay tables

The implementation may use one normalized overlay table or typed overlay tables, but the public contract is the same.

Required data includes:

- network and epoch;
- base snapshot identity;
- object type and object ID;
- upsert or tombstone state;
- canonical projection JSON for live overlay objects;
- relevant relationship and search keys;
- source ledger identity;
- source transaction identity;
- updated time.

Indexes must support bounded:

- exact object lookup;
- object type listing;
- owner, account, and borrower lookup;
- Vault to Loan Broker relationships;
- Loan Broker to Loan relationships;
- asset lookup where supported;
- on-ledger Loan state lookup;
- tombstone suppression;
- created and deleted count deltas.

## Current projections

The verified base supplies the initial complete current object set for its fixed ledger. Incremental validated-ledger processing maintains changes after that base through D1 overlay upserts and deletion tombstones.

### Vault

Stores identity, owner and pseudo-account, canonical asset, total and available assets, maximum, unrealized loss, Share MPT ID, domain, withdrawal policy, scale, flags, raw data where supported, and last source identity.

### Loan Broker

Stores identity, Vault relationship, owner and pseudo-account, sequence values, management fee, debt, cover, cover rates, owner count, flags, raw data where supported, and last source identity.

### Loan

Stores identity, Broker relationship, borrower, sequence, start and payment schedule, remaining payments, outstanding values, fees, rates, scale, flags, on-ledger status, schedule status, raw data where supported, and last source identity.

`next_payment_due_date` is nullable for terminal paid or defaulted Loans. Omitted numeric fields use zero only where the protocol defines a zero default. No timestamp is invented.

## Historical records

### `object_changes`

Normalized before-and-after field changes keyed to canonical transaction and ledger evidence.

### `archived_objects`

Final state, removal ledger and transaction, reason, relationships, and archive timestamp. A specific reason is used only when directly supported; otherwise it remains `unknown`.

### `loan_lifecycle_events`

Ordered Loan events with transaction identity, close time, status before and after, schedule status, amounts, and normalized details. Schedule-derived status remains separate from on-ledger status.

### `balance_history`

Asset-scoped debt, cover, and loss history. Direct rows retain recorded fields. Derived rows retain formulas and source fields. Unlike assets are never combined.

### `daily_aggregates`

Asset-separated daily counts and amounts for protocol objects, debt, cover, loss, states, and events.

## Relationships

```text
network_epoch
  |- active_base_read_model
  |   |- manifest
  |   |- Vault pages
  |   |- Loan Broker pages
  |   |- Loan pages
  |   |- exact lookup data
  |- D1 current_overlay
  |   |- upserts
  |   |- deletion tombstones
  |   |- overlay watermark
  |- processed_ledgers
  |- protocol_events
  |   |- object_changes
  |- archived_objects
  |- loan_lifecycle_events
  |- balance_history
```

A Loan references a Loan Broker. A Loan Broker references a Vault. Current relationships resolve only inside one network, epoch, and active base-plus-overlay context. Asset identity is inherited from the Vault and may be denormalized for bounded reads.

## Numeric storage

- Do not use binary floating point for canonical ledger amounts.
- Preserve exact numeric strings, integer rates, asset scale, raw representation, and null separately from zero.
- Preserve Ripple epoch values and derive UTC display values separately.

## Current versus historical truth

- Base records and overlay upserts are current-state projections.
- Transactions, changes, lifecycle events, balance history, and archived states provide historical evidence.
- A missing current object is not proof of historical nonexistence.
- A complete base does not imply complete pre-base history.
- A current result is fresh only through the reported contiguous overlay watermark and collector cursor.
- A tombstone removes an object from current truth but not from retained history.

## Index requirements

Index network, epoch, base snapshot identity, object type and ID, ledger index, close time, transaction type, relationships, borrower, owner, account, asset key, status, overlay operation, and archive ledger where required by bounded queries.

## Retention

Keep:

- normalized canonical history within the documented evidence boundary;
- final archived states;
- the active verified base read model;
- bounded current overlay state required after the base;
- deletion tombstones until verified base replacement and reconciliation make compaction safe;
- manifest identity and publication evidence required to verify the active base;
- daily aggregates.

Raw JSON retention is configurable. Overlay compaction requires a verified replacement base and explicit reconciliation.