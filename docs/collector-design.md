# Collector design

## Objective

Continuously reconstruct XRPL Lending current state and history from validated ledgers while remaining restartable, idempotent, auditable, and bounded.

## Canonical source

Only validated ledgers and validated transaction metadata are canonical.

Current ledger objects build or verify projections. Historical evidence comes from indexed transactions, normalized AffectedNodes, lifecycle events, and archived final states.

## Collection modes

### Bootstrap current-state scan

On an empty deployment or a new epoch:

1. Fix one validated ledger hash and index.
2. Start one unfiltered binary `ledger_data` traversal.
3. Decode each bounded page and classify Vault, LoanBroker, and Loan objects locally.
4. Write normalized objects to an inactive D1 snapshot in bounded batches.
5. Record deterministic object and batch hashes, counts, and normalized byte totals.
6. Persist the exact opaque continuation marker only after the matching D1 batch is durable.
7. Validate Vault to LoanBroker to Loan relationships and Broker OwnerCount reconciliation.
8. Verify the complete manifest only after the final marker is absent and all checks pass.
9. Atomically switch the active D1 snapshot pointer after verification.
10. Preserve the previous active snapshot whenever collection, validation, or activation fails.

The bootstrap scan provides current objects, not complete history.

The full bootstrap runs in a resumable long-running runner. A scheduled Worker does not perform the global marker traversal. Three separate filtered traversals are prohibited because the endpoint advances filters through the same global marker chain.

### Incremental ledger collector

Each scheduled run:

1. Read the committed cursor and verified active snapshot identity.
2. Fetch the latest validated ledger.
3. Detect a possible network reset before processing.
4. Select a bounded contiguous ledger range after the cursor.
5. Fetch each ledger with transactions and metadata.
6. Filter supported transaction types.
7. Normalize affected-object IDs and field changes.
8. Apply processed-ledger, event, change, lifecycle, current projection, balance, and archive writes atomically at the documented boundary.
9. Advance the cursor only after successful persistence.
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

Unrecognized future transaction types or fields are reported rather than silently discarded.

## Idempotency

Required unique identities include:

- transaction: network + epoch + transaction hash;
- object change: network + epoch + transaction hash + object ID + field + change kind;
- lifecycle event: network + epoch + Loan ID + transaction hash + event type;
- current object: network + epoch + snapshot ID + object ID;
- snapshot batch: network + epoch + snapshot ID + batch sequence;
- manifest: network + epoch + snapshot ID.

Reprocessing a ledger or bootstrap batch must converge without duplicate canonical events or duplicate active snapshots.

## Marker handling

Every paginated bootstrap request must:

- preserve the marker exactly;
- continue until no marker remains;
- enforce a page ceiling per resumable unit;
- persist the next marker only after the current D1 batch is durable;
- reject repeated markers;
- reject a changed ledger hash or index;
- expose pages processed and continuation state in health evidence.

A page ceiling pauses work. It does not mark the bootstrap complete. Partial counts are never presented as totals.

## Loan zero omission

Canonical XRPL binary decoding may omit numeric fields whose value is zero. The collector normalizes omitted numeric Loan fields to zero only where the protocol defines numeric zero state.

`NextPaymentDueDate` is different: terminal paid or defaulted Loans can remove it. The projection stores it as `null`. If `PaymentRemaining` is greater than zero while the next due date is absent, normalization fails closed.

## Bounded work

Configuration includes:

- maximum ledgers and RPC requests per scheduled run;
- maximum marker pages and decoded objects per bootstrap unit;
- maximum D1 rows, statements, and normalized bytes per batch;
- maximum transactions per ledger before deferral;
- maximum retries per endpoint;
- execution deadline margin;
- export and API pagination limits.

When behind, the collector catches up across multiple runs rather than exceeding runtime limits.

## Endpoint strategy

- Use the official Lending Devnet endpoint as primary.
- Maintain a validated fallback when available.
- Record which endpoint served each run.
- Apply bounded exponential backoff with jitter.
- Never advance the cursor after an incomplete response.
- Never resume a bootstrap against a different ledger identity.

## Object refresh strategy

AffectedNodes provide most changes. Refresh an affected Vault, LoanBroker, or Loan with `ledger_entry` when:

- the normalized change is incomplete;
- a newly created object needs complete state;
- flags or relationships require confirmation;
- a periodic integrity check is due.

Use `vault_info` where Share MPT or Vault-specific information is unavailable through the basic object response.

## Removal handling

When a DeletedNode is observed:

1. Save final and previous fields.
2. Copy the latest projection into `archived_objects`.
3. Classify the reason only when the source evidence supports it.
4. Remove the object from the current projection.
5. Keep relationships and search aliases in historical indexes.

The reason remains `unknown` when evidence is insufficient.

## Lifecycle reconstruction

For each Loan, order canonical events by ledger index and transaction index. Derive lifecycle events from supported transactions and normalized changes.

Do not reconstruct original terms from the current object when the creation transaction contains authoritative values.

## Devnet reset detection

Potential signals include:

- latest validated ledger index lower than the committed cursor;
- a known index with a different hash;
- unexpected server history changes;
- a configured reset marker.

After confirmation, stop incremental processing, archive the current epoch, create a new epoch, perform a new bootstrap, preserve prior records, and expose a reset notice.

## Integrity reconciliation

Scheduled reconciliation compares:

- current-object scans versus active projections;
- Broker OwnerCount versus indexed Loan relationships;
- LoanBroker Vault references versus current or archived Vaults;
- Loan references versus current or archived Brokers;
- asset-separated aggregates versus object-level values;
- cursor continuity and ledger hashes;
- active manifest counts, object hashes, batch hashes, and same-snapshot relationships.

Differences are recorded and corrected only through a documented deterministic process.

## Failure behavior

- Serve last committed data with a stale warning when safe.
- Never fabricate missing state.
- Never skip a failed ledger.
- Never activate an incomplete or digest-invalid manifest.
- Preserve the previous active snapshot after failure.
- Retain incomplete attempts only while resumable or required for bounded verification.
- Keep public errors free of credentials, provider account identifiers, and internal incident details.

## Initial cadence

The scheduled incremental target is once per minute, subject to measured Worker and RPC behavior. Full bootstrap is on-demand and resumable rather than minute-scheduled.

Cadence may change according to measured runtime, RPC capacity, and freshness requirements. The interface always reports actual freshness.
