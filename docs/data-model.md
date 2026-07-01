# Data model

## Global keys

Every canonical record must include:

- `network` — `devnet` or `mainnet`;
- `epoch_id` — identifies a continuous ledger history segment;
- `ledger_index` or `last_ledger_index`;
- source transaction hash where applicable;
- created and updated timestamps in UTC.

No query may join records across networks or epochs without an explicit aggregate layer.

## Provenance

User-facing fields use one of:

- `direct`
- `derived`
- `indexed`
- `unavailable`

Derived fields must also expose a formula identifier. Indexed fields must expose the historical source range or event references where practical.

## Core tables

### `network_epochs`

- `id`
- `network`
- `status` — current or archived
- `first_ledger_index`
- `first_ledger_hash`
- `last_ledger_index`
- `last_ledger_hash`
- `started_at`
- `ended_at`
- `reset_reason`
- `created_at`

### `sync_state`

One active row per network.

- `network`
- `epoch_id`
- `last_processed_ledger`
- `last_processed_hash`
- `latest_observed_ledger`
- `last_attempt_at`
- `last_success_at`
- `status`
- `consecutive_failures`
- `endpoint`
- `error_code`
- `error_message`

### `transactions`

- `network`
- `epoch_id`
- `tx_hash`
- `ledger_index`
- `transaction_index`
- `close_time`
- `transaction_type`
- `result`
- `account`
- `sequence`
- `fee`
- `vault_id`
- `loan_broker_id`
- `loan_id`
- `raw_json` — optional and retention-controlled
- `created_at`

Unique key: network + epoch + transaction hash.

### `object_changes`

Normalized AffectedNodes changes.

- `network`
- `epoch_id`
- `tx_hash`
- `ledger_index`
- `object_type`
- `object_id`
- `change_kind` — created, modified, deleted
- `field_name`
- `before_value`
- `after_value`
- `value_type`
- `created_at`

### `vaults_current`

- `network`
- `epoch_id`
- `vault_id`
- `owner`
- `account`
- `asset_type`
- `asset_key`
- `asset_json`
- `assets_total`
- `assets_available`
- `assets_maximum`
- `loss_unrealized`
- `share_mpt_id`
- `domain_id`
- `withdrawal_policy`
- `scale`
- `flags`
- `data_hex`
- `last_tx_hash`
- `last_ledger_index`
- `last_seen_at`

### `loan_brokers_current`

- `network`
- `epoch_id`
- `loan_broker_id`
- `vault_id`
- `owner`
- `account`
- `management_fee_rate`
- `debt_total`
- `debt_maximum`
- `cover_available`
- `cover_rate_minimum`
- `cover_rate_liquidation`
- `owner_count`
- `loan_sequence`
- `flags`
- `data_hex`
- `last_tx_hash`
- `last_ledger_index`
- `last_seen_at`

### `loans_current`

- `network`
- `epoch_id`
- `loan_id`
- `loan_broker_id`
- `borrower`
- `loan_sequence`
- `start_date`
- `next_payment_due_date`
- `payment_interval`
- `grace_period`
- `payment_remaining`
- `principal_outstanding`
- `total_value_outstanding`
- `management_fee_outstanding`
- `periodic_payment`
- all supported interest-rate fields
- all supported fee fields
- `loan_scale`
- `flags`
- `data_hex`
- `on_ledger_status`
- `schedule_status`
- `last_tx_hash`
- `last_ledger_index`
- `last_seen_at`

### `object_history`

Sparse state snapshots written only when values change.

- `network`
- `epoch_id`
- `object_type`
- `object_id`
- `ledger_index`
- `tx_hash`
- `state_json`
- `change_summary_json`
- `created_at`

### `archived_objects`

- `network`
- `epoch_id`
- `object_type`
- `object_id`
- `final_state_json`
- `created_ledger_index`
- `deleted_ledger_index`
- `created_tx_hash`
- `deleted_tx_hash`
- `deletion_reason`
- `archived_at`

### `loan_lifecycle_events`

- `network`
- `epoch_id`
- `loan_id`
- `event_sequence`
- `event_type`
- `ledger_index`
- `tx_hash`
- `close_time`
- `on_ledger_status_before`
- `on_ledger_status_after`
- `schedule_status_at_event`
- `amount_json`
- `details_json`

### `daily_aggregates`

Asset-separated daily summaries.

- `network`
- `epoch_id`
- `date_utc`
- `asset_key`
- `vault_count`
- `broker_count`
- `loan_count`
- `assets_total`
- `assets_available`
- `debt_total`
- `cover_available`
- `loss_unrealized`
- state counts
- event counts

## Relationships

```text
network_epoch
  |- vault
  |   |- loan_broker
  |       |- loan
  |- transaction
  |   |- object_changes
  |- archived_object
  |- lifecycle_event
```

A Loan references a LoanBroker. A LoanBroker references a Vault. Asset identity is inherited from the Vault but should be denormalized into API projections for efficient reads.

## Numeric storage

Do not use JavaScript floating-point values for canonical ledger amounts.

- Store canonical numeric strings exactly as received.
- Store rate integers exactly as received.
- Use explicit decimal utilities for calculations.
- Preserve asset scale and amount representation.
- Convert Ripple epoch times to UTC only in derived/API fields; preserve raw values.

## Current versus historical truth

- Current tables are rebuilt or updated projections.
- Transactions, changes, lifecycle events, and archived objects provide historical truth.
- A missing current object is not proof of its historical nonexistence.
- Deletion must be represented explicitly rather than by silently removing all records.

## Index requirements

At minimum:

- network + epoch + object ID
- network + epoch + ledger index
- network + epoch + close time
- transaction type + close time
- Vault ID on Broker
- Broker ID on Loan
- Borrower
- asset key
- on-ledger status
- schedule status
- deleted ledger index

## Retention

Keep normalized transactions, object changes, lifecycle events, final deleted states, and daily aggregates.

Raw JSON retention is configurable and may be pruned after normalization and verification. Repeated unchanged snapshots are prohibited.
