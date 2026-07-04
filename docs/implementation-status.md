# Implementation status

Last updated: 2026-07-05.

## Current phase

M1 incremental continuation is active. M1-HYB-4 scheduled incremental collector wiring is complete at its implementation checkpoint. M0, M2, M3, M4, and M5-1 through M5-4 are complete at their documented implementation checkpoints. M5-5 and M6 remain gated behind M1 exit.

## Production state

A verified Devnet base read model is serving current Vault, Loan Broker, and Loan data through the public current-state API path.

The active published base is fixed to validated Devnet ledger `3371675` and contains:

- 797,550 Vault records;
- 528,228 Loan Broker records;
- 226,725 Loan records;
- 1,552,503 total current-state records.

The bounded D1 current-state overlay foundation is implemented and migration-tested locally. It includes base identity binding, overlay watermark state, current-object upserts, deletion tombstones, bounded lookup indexes, idempotent replay handling, stale-mutation rejection, same-position conflict rejection, and compare-and-set watermark advancement.

The overlay is connected to the incremental collector persistence boundary. Processed ledgers, protocol events, normalized object changes, Loan lifecycle events, deleted-object archives, balance history, current-state overlay upserts, deletion tombstones, overlay watermark advancement, and sync cursor advancement are committed in one guarded D1 batch.

The overlay is connected to public current-state API resolution for Overview, current Vault, Loan Broker, Loan, exact Search, Account, and relationship reads.

The scheduled Worker path refreshes network status and runs one bounded incremental collection cycle. The collector applies explicit ledger, request, transaction, row, statement, overlay-mutation, retry, and execution-deadline limits; processes only a contiguous prefix; records lag and run usage; exposes collector status; and waits for explicit cursor/base initialization rather than silently rebinding epochs. Production catch-up has not started. Mainnet remains disabled.

## Completed units

- Devnet network, epoch, reset, and synchronization state.
- Canonical XRP, IOU, and MPT normalization.
- Complete unfiltered `ledger_data` traversal primitives with exact opaque marker handling.
- Resumable fixed-ledger bootstrap scanning.
- Current Vault, Loan Broker, and Loan normalization and relationship checks.
- Terminal Loan zero-omission handling.
- Deterministic compressed artifact generation, digests, manifests, and verification.
- Persistent resumable artifact checkpoints and complete fixed-ledger measurement tooling.
- Verified full Devnet base snapshot materialization.
- Lightweight current-state read-model compilation.
- Immutable current-state data publication with active channel resolution.
- Bounded current-state readers for Vault, Loan Broker, and Loan list/detail routes.
- Bounded pagination, exact object lookup, filters, relationship navigation, and search validation.
- Incremental validated-ledger scan foundation.
- AffectedNodes normalization.
- Loan lifecycle derivation.
- Deleted-object archive derivation.
- Cover, debt, and loss history derivation.
- Status and reconciliation logic.
- Public historical API contracts, exports, feeds, and baseline UI routes.
- D1 current-state overlay schema.
- D1 overlay base identity binding and fail-closed mismatch handling.
- D1 current-object upsert and deletion tombstone primitives.
- D1 overlay indexes for current list, owner, account, borrower, Vault relationship, Broker relationship, asset, status, and ledger ordering.
- Overlay replay, stale ordering, conflict, tombstone, and watermark guard tests.
- Incremental current-projection derivation from CreatedNode NewFields and ModifiedNode FinalFields.
- Incremental deletion tombstone derivation from DeletedNode FinalFields.
- Guarded incremental commit integration that advances historical evidence, current overlay state, overlay watermark, and sync cursor together or rejects the batch.
- Base-plus-overlay current API resolution for Overview counts and metadata.
- Base-plus-overlay Vault, Loan Broker, and Loan list/detail reads.
- Overlay-aware exact Search, Account, and relationship reads.
- Tombstone suppression for current detail, list, search, count, and relationship resolution.
- Base identity, overlay watermark, collector cursor, and freshness metadata exposure in current Overview.
- Focused resolver, pagination, relationship, and count-delta tests for base-plus-overlay behavior.
- Scheduled Worker integration for one bounded incremental collection cycle per trigger.
- Explicit limits for ledgers, RPC requests, per-ledger transactions, inspected transactions, Lending transactions, rows, statements, overlay mutations, retries, and execution time.
- Deadline-aware scan stopping before the next ledger read.
- Contiguous-prefix budget selection before atomic persistence.
- Fail-closed preflight behavior for uninitialized cursor/base state, reset suspicion, and overlay/cursor divergence.
- Bounded endpoint retry and fallback handling with request-budget accounting.
- Collector status exposure for cursor, lag, freshness, run timing, bounded usage, failures, and endpoint state.

## Resource decision

A 500-page local Devnet sample decoded 1,024,000 ledger objects and stored 67,407 Lending objects. The measured D1 growth and projection placed the row-per-object full current-state snapshot design outside the project's documented 350 MB safety envelope.

The D1-only full-snapshot path therefore stopped before remote current-state migration. The active architecture is now a complete immutable verified base read model plus bounded D1 incremental history and current-state overlay.

The earlier D1-only migration work remains useful as integrity, rollback, resume, immutability, and resource evidence, but it is not the active production current-state storage plan.

## Active unit

M1-HYB-5 catch-up rehearsal and reconciliation is next.

The completed M1-HYB-4 scheduled path now:

1. refreshes Devnet network status independently;
2. refuses to run without an explicit initialized cursor and matching overlay base binding;
3. scans only the next contiguous validated ledger range;
4. stops before the next ledger read when the execution deadline margin is reached;
5. selects only the largest contiguous prefix that fits configured row, statement, transaction, and overlay budgets;
6. commits through the guarded history-plus-overlay atomic persistence boundary;
7. records actual remaining lag and bounded run usage;
8. exposes healthy, behind, stale, error, reset-suspected, and initialization states without assuming freshness from the target cadence.

## Next order

1. Rehearse catch-up from base ledger plus one with interruption, resume, replay, gap rejection, and reconciliation.
2. Start bounded production catch-up from the ledger after the active base ledger.
3. Verify newly created, modified, paid, impaired, defaulted, and deleted objects through real Devnet continuation.
4. Complete M1 exit review, then M5-5 and M6.

## Blockers

- Catch-up interruption, resume, replay, gap rejection, and reconciliation rehearsal is not yet complete.
- Production catch-up from the active base ledger has not started.
- Continuous monitoring, reconciliation, M5-5, and M6 evidence remain incomplete.

## Public-information boundary

This status document records product architecture, verified evidence, implementation state, resource decisions, and release blockers only. It does not publish credentials, provider account details, workflow run identifiers, internal incident narratives, private operational constraints, or unrelated project context.
