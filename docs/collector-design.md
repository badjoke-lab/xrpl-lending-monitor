# Collector design

## Objective

Continuously reconstruct XRPL Lending current state and history from validated ledgers while remaining restartable, idempotent, auditable, and compatible with Cloudflare free-tier constraints.

## Canonical source

Only validated ledgers and validated transaction metadata are canonical.

Current ledger objects are used to build or verify projections. Historical truth comes from indexed transactions, normalized AffectedNodes, lifecycle events, and archived final states.

## Collection modes

### Bootstrap current-state scan

On an empty database or a new epoch:

1. Fetch the latest validated ledger identity.
2. Page through `ledger_data` for `vault`, `loan_broker`, and `loan` until no marker remains.
3. Store current projections with the bootstrap ledger.
4. Record all markers, page counts, object counts, and elapsed time.
5. Do not call the bootstrap scan complete if any page fails.

The bootstrap scan provides current objects, not complete history.

### Incremental ledger collector

Each scheduled run:

1. Read the committed cursor.
2. Fetch the latest validated ledger.
3. Detect a possible network reset before processing.
4. Select a bounded ledger range after the cursor.
5. Fetch each ledger with transactions and metadata.
6. Filter supported transaction types.
7. Normalize affected-object IDs and field changes.
8. Apply transaction, change, lifecycle, current projection, and archive writes in a transaction where practical.
9. Commit the cursor only after successful processing.
10. Record health and usage metrics.

## Supported transaction types

- VaultCreate
- VaultDeposit
- VaultWithdraw
- VaultSet
- VaultClawback
- VaultDelete
- LoanBrokerSet
- LoanBrokerCoverDeposit
- LoanBrokerCoverWithdraw
- LoanBrokerCoverClawback
- LoanBrokerDelete
- LoanSet
- LoanPay
- LoanManage
- LoanDelete

Unrecognized future transaction types or fields must be logged, not silently discarded.

## Idempotency

Required unique identities:

- transaction: network + epoch + transaction hash
- object change: network + epoch + transaction hash + object ID + field + change kind
- lifecycle event: network + epoch + Loan ID + transaction hash + event type
- current object: network + epoch + object ID

Reprocessing a ledger must produce the same canonical state without duplicate events.

## Marker handling

Every paginated RPC request must:

- preserve the marker exactly;
- continue until no marker remains;
- enforce a high but explicit page ceiling as an operational guard, not as a silent truncation rule;
- fail the scan if the ceiling is reached;
- expose pages processed and truncation status in health output.

Counts from a partial page must never be presented as total counts.

## Bounded work

Configuration includes:

- maximum ledgers per scheduled run;
- maximum RPC requests per run;
- maximum transactions per ledger before deferral;
- maximum retries per endpoint;
- execution deadline margin;
- export and API pagination limits.

When behind, the collector catches up across multiple runs rather than exceeding runtime limits.

## Endpoint strategy

- Use the official Lending Devnet endpoint as primary.
- Maintain at least one validated fallback when available.
- Record which endpoint served each collector run.
- Apply exponential backoff with jitter.
- Never advance the cursor after an incomplete ledger response.

## Object refresh strategy

AffectedNodes should provide most changes. After relevant transactions, refresh the affected Vault, LoanBroker, or Loan with `ledger_entry` when:

- the normalized change is incomplete;
- a newly created object needs its complete state;
- flags or derived relationships require confirmation;
- a periodic integrity check is due.

Use `vault_info` where Share MPT or Vault-specific information is not available through the basic object response.

## Deletion handling

When a DeletedNode is observed:

1. Save the final fields and previous fields.
2. Copy the latest projection into `archived_objects`.
3. Classify the deletion reason from transaction type and lifecycle context.
4. Remove the object from the current projection.
5. Keep all relationships and search aliases in historical indexes.

Deletion-reason classification may be `unknown` when evidence is insufficient.

## Lifecycle reconstruction

For each Loan, order canonical events by ledger index and transaction index. Derive lifecycle events from LoanSet, LoanPay, LoanManage, LoanDelete, and relevant object changes.

Do not reconstruct original terms from the current object when the creation transaction provides authoritative values such as requested principal or payment total.

## Devnet reset detection

Potential reset signals:

- latest validated ledger index is lower than the committed cursor;
- a known ledger index has a different hash;
- server identity or history range changes unexpectedly;
- a configured reset marker is observed.

On detection:

1. stop incremental processing;
2. verify the signal with a second request or endpoint;
3. archive the current epoch;
4. create a new epoch;
5. perform a new bootstrap scan;
6. preserve all prior records unchanged;
7. show a reset notice in API health data.

## Integrity reconciliation

Scheduled reconciliation compares:

- full current-object scans versus current projections;
- Broker OwnerCount versus indexed Loan relationships;
- LoanBroker VaultID references versus existing or archived Vaults;
- Loan references versus existing or archived Brokers;
- aggregate totals versus object-level sums by asset;
- cursor continuity and ledger hashes.

Differences are recorded and repaired only through a documented deterministic process.

## Failure behavior

- Serve last committed data with a stale warning.
- Never fabricate missing state.
- Never skip a failed ledger.
- Record parser failures with transaction hash and ledger.
- Keep failed raw payloads temporarily for debugging when safe.
- Alert through CI, health endpoint, or repository automation when persistent.

## Initial cadence

Target scheduled cadence: once per minute, subject to measured Worker and RPC behavior.

Cadence may be reduced to preserve free operation. Data freshness is shown explicitly, so a slower cadence does not masquerade as real time.
