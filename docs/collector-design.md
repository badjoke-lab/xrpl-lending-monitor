# Collector design

## Objective

Continuously reconstruct XRPL Lending current state and history from validated ledgers while remaining restartable, idempotent, auditable, and compatible with bounded runtime and storage constraints.

## Canonical source

Only validated ledgers and validated transaction metadata are canonical.

Current ledger objects are used to build or verify projections. Historical truth comes from indexed transactions, normalized AffectedNodes, lifecycle events, and archived final states.

## Collection modes

### Bootstrap current-state scan

On an empty deployment or a new epoch:

1. Fetch and persist the selected validated ledger hash and index.
2. Start one unfiltered binary `ledger_data` traversal.
3. Decode each bounded page and classify Vault, LoanBroker, and Loan objects locally.
4. Preserve the opaque marker exactly after each successful batch.
5. Normalize objects while writing bounded compressed shards.
6. Record shard hashes, counts, ranges, and locations in a building manifest.
7. Validate Vault to Broker to Loan relationships and Broker OwnerCount reconciliation.
8. Publish the complete manifest only after the final marker is absent and all checks pass.
9. Activate the snapshot in D1 only after manifest verification.
10. Keep the previous active snapshot when any batch, upload, validation, or activation step fails.

The bootstrap scan provides current objects, not complete history.

The full bootstrap runs in a resumable long-running runner. A scheduled Cloudflare Worker does not perform the global marker traversal. Three separate filtered traversals are prohibited because the Devnet endpoint advances each filter through the same global ledger marker chain.

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

Incremental collection begins only after an initial active snapshot exists.

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
- bootstrap shard: network + epoch + snapshot ID + object type + shard sequence
- bootstrap manifest: network + epoch + snapshot ID

Reprocessing a ledger or bootstrap batch must produce the same canonical state without duplicate events or duplicate active snapshots.

## Marker handling

Every paginated RPC request must:

- preserve the marker exactly;
- continue until no marker remains;
- enforce an explicit page ceiling per batch;
- persist the next marker only after the current batch and shard are durable;
- reject repeated markers;
- reject a changed ledger hash or index;
- expose pages processed and continuation state in health output.

A page ceiling pauses a resumable batch. It does not mark a bootstrap complete. Counts from a partial traversal must never be presented as total counts.

## Loan zero omission

Canonical XRPL binary decoding may omit numeric fields whose value is zero. The collector normalizes omitted numeric Loan fields to zero where the protocol defines numeric zero state.

`NextPaymentDueDate` is different: terminal paid or defaulted Loans can remove the field. The projection stores it as `null`. If `PaymentRemaining` is greater than zero while the next due date is absent, normalization fails closed.

## Bounded work

Configuration includes:

- maximum ledgers per scheduled run;
- maximum RPC requests per run;
- maximum marker pages per bootstrap batch;
- maximum decoded objects per batch;
- maximum shard size;
- maximum transactions per ledger before deferral;
- maximum retries per endpoint or upload;
- execution deadline margin;
- export and API pagination limits.

When behind, the collector catches up across multiple runs rather than exceeding runtime limits.

## Endpoint strategy

- Use the official Lending Devnet endpoint as primary.
- Maintain at least one validated fallback when available.
- Record which endpoint served each collector run.
- Apply exponential backoff with jitter.
- Never advance the cursor after an incomplete ledger response.
- Never resume a bootstrap against a different ledger identity.

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
- cursor continuity and ledger hashes;
- active manifest counts and shard hashes.

Differences are recorded and repaired only through a documented deterministic process.

## Failure behavior

- Serve last committed data with a stale warning.
- Never fabricate missing state.
- Never skip a failed ledger.
- Never activate an incomplete manifest.
- Record parser failures with transaction hash and ledger.
- Keep failed raw payloads temporarily for debugging when safe.
- Clean up incomplete bootstrap artifacts only after they are no longer resumable or referenced.
- Alert through CI, health endpoint, or repository automation when persistent.

## Initial cadence

The scheduled incremental target is once per minute, subject to measured Worker and RPC behavior. Full bootstrap is on-demand and resumable rather than minute-scheduled.

Cadence may be adjusted according to measured runtime, RPC capacity, and data-freshness requirements. Data freshness is shown explicitly, so a slower cadence does not masquerade as real time.
