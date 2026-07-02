# Data model

## Global keys

Every canonical record must include network, epoch, ledger identity, source transaction where applicable, and UTC timestamps. Queries must not join networks or epochs without an explicit aggregate layer.

## Provenance

User-facing fields are labeled `direct`, `derived`, `indexed`, or `unavailable`. Derived fields expose a formula identifier. Indexed fields expose historical source references where practical.

## Bootstrap snapshots

### `current_state_snapshots`

One row per bootstrap or replacement attempt:

- `id`, `network`, `epoch_id`;
- validated `ledger_index` and `ledger_hash`;
- `status` — `building`, `active`, `failed`, or `superseded`;
- exact `next_marker_json`;
- page and object counts;
- Vault, LoanBroker, and Loan counts;
- `manifest_url` and `manifest_hash`;
- failure code and message;
- start, update, and activation timestamps.

Only one snapshot per network and epoch may be active. Activation requires a verified complete manifest and no continuation marker.

### External manifest and shards

The manifest records schema version, network, epoch, snapshot ID, validated ledger identity, total counts, validation status, ordered shard descriptors, and a complete-manifest hash.

Each shard descriptor records object type, sequence, object count, compressed byte size, content hash, and storage location. Full bootstrap object rows are stored in bounded compressed shards. D1 stores snapshot metadata, the manifest reference, and the active pointer.

## Core tables

### `network_epochs`

Tracks continuous ledger history segments, their first and last ledger identities, status, timestamps, and reset reason.

### `sync_state`

One active row per network with epoch, incremental cursor, latest observed ledger, active snapshot ID, attempts, success time, status, endpoint, and error state.

### `transactions`

Canonical transaction records keyed by network, epoch, and transaction hash. Includes ledger and transaction ordering, close time, type, result, account, fee, related object IDs, and optional retention-controlled raw JSON.

### `incremental_commit_guards`

Internal transient rows used only inside an incremental collector D1 batch. A guard records the expected cursor and the cursor observed at batch execution time. Constraint failure aborts the batch before processed-ledger or protocol-event rows can persist. Successful batches delete their guard row before commit.

### `object_changes`

Normalized AffectedNodes changes keyed by transaction, object, field, and change kind. Stores before and after values with explicit value type.

Each row includes network, epoch, transaction hash, ledger index, transaction order, transaction type, result, close time, node index, object type, object ID, action, field name, before JSON, after JSON, value type, unsupported-field flag, and directly supported relationship identifiers for Vault, LoanBroker, Loan, account, owner, borrower, asset, and MPT issuance.

## Current projections

The active bootstrap snapshot supplies the initial object set. Incremental validated-ledger processing maintains projections after activation.

### Vault

Stores identity, owner and pseudo-account, canonical asset, total and available assets, maximum, unrealized loss, Share MPT ID, domain, withdrawal policy, scale, flags, raw data, and last transaction and ledger identity.

### LoanBroker

Stores identity, Vault relationship, owner and pseudo-account, sequence values, management fee, debt, cover, cover rates, owner count, flags, raw data, and last transaction and ledger identity.

### Loan

Stores identity, Broker relationship, borrower, sequence, start and payment schedule, remaining payments, outstanding values, fees, rates, scale, flags, on-ledger status, schedule status, raw data, and last transaction and ledger identity.

`next_payment_due_date` is nullable for terminal paid or defaulted Loan objects. XRPL binary serialization may omit numeric zero fields. Normalization stores zero for omitted numeric fields where the protocol defines a zero default, but never invents a timestamp. A Loan with payments remaining and no next due date is invalid.

## Historical records

### `object_history`

Sparse object snapshots written only when state changes.

### `archived_objects`

Final state, creation and deletion ledgers and transactions, deletion reason, relationships, and archive timestamp.

Archived objects are written only from DeletedNode evidence for Vault, LoanBroker, and Loan objects. The final state is retained as normalized JSON, relationships remain queryable, and deletion reason is specific only when the transaction type directly supports it; otherwise it is `unknown`.

### `loan_lifecycle_events`

Ordered Loan events with transaction identity, close time, status before and after, schedule status, amounts, and normalized details.

Initial lifecycle rows are derived from normalized Loan object changes. They include event type, transaction identity, close time, on-ledger status before and after, principal and total outstanding before and after, payment remaining before and after, and details JSON. Schedule-derived status remains separate and is not used to mark a Loan defaulted.

### `balance_history`

Asset-scoped debt, cover, and loss history derived from normalized Vault and LoanBroker object changes. Direct rows preserve `DebtTotal`, `DebtMaximum`, `CoverAvailable`, and `LossUnrealized`. Derived rows preserve formulas and source fields for `required_minimum_cover = DebtTotal * CoverRateMinimum / 100000` and `cover_surplus = CoverAvailable - required_minimum_cover`. Rows do not aggregate unlike assets; `asset_key` is present only when directly supported by the normalized change context.

### `daily_aggregates`

Asset-separated daily counts and amounts for Vaults, Brokers, Loans, assets, debt, cover, loss, states, and events.

## Relationships

```text
network_epoch
  |- current_state_snapshot
  |   |- external manifest
  |       |- Vault shards
  |       |- LoanBroker shards
  |       |- Loan shards
  |- vault
  |   |- loan_broker
  |       |- loan
  |- transaction
  |   |- object_changes
  |- archived_object
  |- lifecycle_event
```

A Loan references a LoanBroker. A LoanBroker references a Vault. Asset identity is inherited from the Vault but may be denormalized into API projections for bounded reads.

## Numeric storage

- Never use JavaScript floating point for canonical ledger amounts.
- Preserve exact numeric strings and integer rates.
- Use explicit decimal utilities for calculations.
- Preserve asset scale and raw representation.
- Preserve null separately from numeric zero.
- Preserve raw Ripple epoch values and derive UTC display values separately.

## Current versus historical truth

- Current shards and tables are projections.
- Transactions, changes, lifecycle events, and archived states provide historical truth.
- A missing current object is not proof of historical nonexistence.
- Deletion is explicit and never represented by silently removing all records.
- A complete current snapshot does not imply complete pre-snapshot history.

## Index requirements

At minimum index network and epoch with snapshot status, object ID, ledger index, close time, transaction type, Vault and Broker relationships, borrower, asset key, on-ledger status, schedule status, and deletion ledger.

## Retention

Keep normalized history, final deleted states, active snapshot metadata, required rollback metadata, and daily aggregates. Raw JSON retention is configurable. Repeated unchanged snapshots are prohibited. Incomplete shards may be removed only after they are no longer resumable and are not referenced by an active or rollback manifest.
