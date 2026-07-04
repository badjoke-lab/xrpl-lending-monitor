# Collector design

## Objective

Continuously reconstruct XRPL Lending current state and history from validated ledgers while remaining restartable, idempotent, auditable, and bounded.

## Canonical source

Only validated ledgers and validated transaction metadata are canonical.

Current state is resolved from a verified immutable base read model plus bounded D1 incremental overlay records. Historical evidence comes from indexed transactions, normalized AffectedNodes, lifecycle events, archived final states, and balance history.

## Collection modes

### Bootstrap base-state scan

On an empty deployment, a new epoch, or an explicitly approved base replacement:

1. Fix one validated ledger hash and index.
2. Start one unfiltered binary `ledger_data` traversal.
3. Decode each bounded page and classify Vault, LoanBroker, and Loan objects locally.
4. Write deterministic bounded data and index artifacts.
5. Record and verify page digests, page manifests, exact continuation state, and snapshot-level identity.
6. Validate Vault to LoanBroker to Loan relationships and Broker OwnerCount reconciliation where supported.
7. Verify the complete manifest only after the final marker is absent and all checks pass.
8. Compile the verified complete artifact set into the lightweight current-state read model.
9. Publish the immutable read model and update the active channel only after verification.
10. Preserve the previously active verified base whenever collection, validation, compilation, or publication fails.

The bootstrap scan provides complete current objects for one fixed ledger, not complete pre-bootstrap history.

The full bootstrap runs in a resumable long-running runner. A scheduled Worker does not perform the global marker traversal. Three separate filtered traversals are prohibited because the endpoint advances filters through the same global marker chain.

### Incremental ledger collector

Each scheduled run:

1. Read the committed cursor, current epoch, and active verified base identity.
2. Fetch the latest validated ledger.
3. Detect a possible network reset before processing.
4. Select a bounded contiguous ledger range after the cursor.
5. Fetch each ledger with transactions and metadata.
6. Filter supported transaction types.
7. Normalize affected-object IDs and field changes.
8. Derive lifecycle, archive, balance, and current-projection effects.
9. Persist processed-ledger evidence, protocol events, normalized changes, lifecycle events, archives, balance history, current overlay upserts, deletion tombstones, and cursor movement at the documented canonical commit boundary.
10. Advance the cursor only after successful persistence.
11. Record health and usage metrics.

Incremental collection begins only after an initial verified base exists. The first incremental ledger is the ledger immediately after the base ledger.

## Current-state overlay rules

### Overlay upsert

A supported CreatedNode or ModifiedNode may produce a normalized current projection upsert.

The overlay record must be scoped to:

- network;
- epoch;
- active base snapshot identity;
- object type;
- object ID;
- source ledger index and hash;
- source transaction hash;
- canonical normalized projection;
- relevant relationship and search fields;
- update time.

A replay of already committed canonical evidence converges to the same overlay state and does not create duplicates.

### Deletion tombstone

A supported DeletedNode creates a current-state tombstone for the object and archive evidence where collected.

A tombstone prevents an object still present in the immutable base from reappearing in:

- current list results;
- current detail results;
- exact current search;
- current relationship results;
- current counts and aggregates.

### Public read precedence

Current API resolution is deterministic:

1. overlay upsert wins over base;
2. deletion tombstone hides base;
3. no overlay record falls back to base.

### Overlay watermark

The system records the highest contiguous ledger reflected in the current overlay. It must not exceed the canonical incremental cursor.

Current API freshness uses:

- base ledger identity;
- last processed ledger;
- overlay watermark;
- latest validated ledger;
- last successful collection time.

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
- archived object: network + epoch + object type + object ID;
- overlay state: network + epoch + base snapshot ID + object type + object ID;
- tombstone: network + epoch + base snapshot ID + object type + object ID;
- complete base manifest: network + epoch + base snapshot ID.

Reprocessing a ledger or bootstrap page must converge without duplicate canonical events, duplicate overlay state, or conflicting active base identity.

## Marker handling

Every paginated bootstrap request must:

- preserve the marker exactly;
- continue until no marker remains;
- enforce a page ceiling per resumable unit;
- persist the next marker only after the current artifact output and page manifest are durable;
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
- maximum D1 rows, statements, and normalized bytes per incremental batch;
- maximum current overlay mutations per run;
- maximum transactions per ledger before deferral;
- maximum retries per endpoint;
- execution deadline margin;
- export and API pagination limits;
- bounded base page and lookup reads per public request.

When behind, the collector catches up across multiple runs rather than exceeding runtime limits.

## Endpoint strategy

- Use the approved Lending Devnet endpoint as primary.
- Maintain a validated fallback when available.
- Record which endpoint served each run.
- Apply bounded exponential backoff with jitter.
- Never advance the cursor after an incomplete response.
- Never resume a bootstrap against a different ledger identity.
- Never continue an overlay against a different base identity without an explicit rebasing and reconciliation process.

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
2. Create or update the current-state tombstone.
3. Copy the latest known projection into `archived_objects` where the historical evidence boundary supports it.
4. Classify the reason only when the source evidence supports it.
5. Remove or supersede any live overlay upsert for the same object.
6. Keep relationships and search aliases in historical indexes.

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

After confirmation, stop incremental processing, archive the current epoch, create a new epoch, perform a new complete base bootstrap, preserve prior records, and expose a reset notice.

No new-epoch continuation may reuse a base from the prior epoch.

## Integrity reconciliation

Scheduled or explicitly initiated reconciliation compares:

- verified base identity versus overlay base identity;
- overlay watermark versus canonical cursor;
- base counts plus created/deleted overlay deltas versus resolved current counts;
- current-object spot checks versus resolved base-plus-overlay projections;
- Broker OwnerCount versus indexed Loan relationships;
- LoanBroker Vault references versus current or archived Vaults;
- Loan references versus current or archived Brokers;
- asset-separated aggregates versus resolved object-level values;
- cursor continuity and ledger hashes;
- archived/current exclusion;
- manifest counts and digests for the active base.

Differences are recorded and corrected only through a documented deterministic process.

## Base replacement

A replacement base is not produced every scheduled run.

A replacement cycle:

1. chooses one validated ledger;
2. completes and verifies the full marker traversal;
3. compiles and publishes a new immutable base read model;
4. binds subsequent overlay continuation to the new base identity;
5. reconciles overlap between indexed history and the new base;
6. preserves explicit stale or partial state until continuation is proven contiguous.

Old incremental history remains historical evidence. Overlay records may be compacted only after the replacement base and continuation boundary are verified.

## Failure behavior

- Serve the last verified base plus the last committed overlay with a stale warning when safe.
- Never fabricate missing state.
- Never skip a failed ledger.
- Never advance the overlay watermark beyond the committed cursor.
- Never publish an incomplete or digest-invalid base.
- Never allow a base identity mismatch to fall back silently.
- Preserve the previous verified base after replacement failure.
- Keep public errors free of credentials, provider account identifiers, internal incident details, and unpublished operational strategy.

## Initial cadence

The scheduled incremental target is once per minute, subject to measured Worker, D1, and RPC behavior. Full bootstrap is on-demand and resumable rather than minute-scheduled.

Cadence may change according to measured runtime, RPC capacity, storage growth, and freshness requirements. The interface always reports actual freshness.