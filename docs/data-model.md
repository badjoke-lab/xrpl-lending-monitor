# Data model

## Global keys

Every canonical record includes network, epoch, ledger identity, source transaction where applicable, and UTC timestamps. Queries do not join networks or epochs without an explicit aggregate layer.

## Provenance

User-facing fields are labeled `direct`, `derived`, `indexed`, or `unavailable`. Derived fields expose a formula identifier. Indexed fields expose historical source references where practical.

## D1 current-state snapshots

The accepted current-state model uses versioned D1 rows.

### Snapshot metadata

Each bootstrap or replacement attempt records:

- snapshot, network, epoch, fixed ledger index, and fixed ledger hash;
- status, page count, request count, and object counts;
- Vault, LoanBroker, and Loan counts;
- manifest hash and verification state;
- normalized byte estimates and measured row totals;
- start, completion, activation, and update timestamps.

Completed snapshots are immutable.

### Manifest, batches, and checkpoints

The manifest records schema version, snapshot identity, fixed ledger identity, total counts, ordered batch descriptors, and a complete-manifest hash.

Each bounded batch records sequence, object count, normalized byte count, and deterministic hash. The bootstrap checkpoint retains the exact opaque continuation marker only after the matching batch and typed rows are durable.

### Typed current rows

Snapshot-scoped Vault, LoanBroker, and Loan tables store:

- snapshot, network, epoch, and ledger identity;
- canonical object ID and type;
- normalized API fields;
- deterministic object hash;
- retained normalized raw JSON where supported;
- identifiers required for same-snapshot relationships.

### Active snapshot pointer

One row per network and epoch identifies the verified active snapshot. Activation is an atomic pointer change after complete count, hash, manifest, and relationship verification.

The previous active snapshot remains available for rollback. Activation does not overwrite completed snapshot rows.

### Incomplete-attempt eligibility

An incomplete attempt is removable only when an explicit eligibility record confirms that it is not active, not the rollback target, and not resumable.

## Core tables

### `network_epochs`

Tracks continuous ledger history segments, first and last ledger identities, status, timestamps, and reset reason.

### `sync_state`

Tracks the current epoch, incremental cursor, latest observed ledger, active snapshot identity, attempts, success time, status, endpoint, and error state.

### `processed_ledgers`

Records committed validated ledger identity, ordering, close time, parent continuity, transaction count, and processing metadata.

### `protocol_events`

Stores canonical Lending-related transaction events keyed by network, epoch, ledger, transaction order, and transaction hash.

### `incremental_commit_guards`

Transient rows used inside an incremental D1 batch. A constraint mismatch aborts the batch before processed-ledger or protocol-event rows persist.

### `object_changes`

Stores normalized AffectedNodes changes with transaction, ledger, object, action, field, before, after, value type, unsupported-field flag, and directly supported relationships.

## Current projections

The verified active D1 snapshot supplies the initial current object set. Incremental validated-ledger processing maintains projections after activation.

### Vault

Stores identity, owner and pseudo-account, canonical asset, total and available assets, maximum, unrealized loss, Share MPT ID, domain, withdrawal policy, scale, flags, raw data, and last source identity.

### LoanBroker

Stores identity, Vault relationship, owner and pseudo-account, sequence values, management fee, debt, cover, cover rates, owner count, flags, raw data, and last source identity.

### Loan

Stores identity, Broker relationship, borrower, sequence, start and payment schedule, remaining payments, outstanding values, fees, rates, scale, flags, on-ledger status, schedule status, raw data, and last source identity.

`next_payment_due_date` is nullable for terminal paid or defaulted Loans. Omitted numeric fields use zero only where the protocol defines a zero default. No timestamp is invented.

## Historical records

### `object_history`

Sparse object snapshots written only when state changes.

### `archived_objects`

Final state, creation and removal ledgers and transactions, reason, relationships, and archive timestamp. A specific reason is used only when directly supported; otherwise it remains `unknown`.

### `loan_lifecycle_events`

Ordered Loan events with transaction identity, close time, status before and after, schedule status, amounts, and normalized details. Schedule-derived status remains separate from on-ledger status.

### `balance_history`

Asset-scoped debt, cover, and loss history. Direct rows retain recorded fields. Derived rows retain formulas and source fields. Unlike assets are never combined.

### `daily_aggregates`

Asset-separated daily counts and amounts for protocol objects, debt, cover, loss, states, and events.

## Relationships

```text
network_epoch
  |- active_snapshot_pointer
  |   |- verified current_state_snapshot
  |       |- manifest and bounded batches
  |       |- Vault rows
  |       |- LoanBroker rows
  |       |- Loan rows
  |- protocol_event
  |   |- object_changes
  |- archived_object
  |- lifecycle_event
```

A Loan references a LoanBroker. A LoanBroker references a Vault. Current relationships resolve only within one snapshot. Asset identity is inherited from the Vault and may be denormalized for bounded reads.

## Numeric storage

- Do not use binary floating point for canonical ledger amounts.
- Preserve exact numeric strings, integer rates, asset scale, raw representation, and null separately from zero.
- Preserve Ripple epoch values and derive UTC display values separately.

## Current versus historical truth

- Current snapshot rows are projections.
- Transactions, changes, lifecycle events, and archived states provide historical evidence.
- A missing current object is not proof of historical nonexistence.
- A complete current snapshot does not imply complete pre-snapshot history.

## Index requirements

Index network, epoch, active snapshot, snapshot and object ID, ledger index, close time, transaction type, relationships, borrower, asset key, status, and archive ledger where required by bounded queries.

## Retention

Keep normalized history, final archived states, the active verified snapshot, one verified rollback snapshot, required manifest and checkpoint evidence, and daily aggregates. Raw JSON retention is configurable. Incomplete attempts remain only while needed for resume or bounded verification.
