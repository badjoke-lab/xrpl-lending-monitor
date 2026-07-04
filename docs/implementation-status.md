# Implementation status

Last updated: 2026-07-04.

## Current phase

M1 incremental continuation and base-plus-overlay integration is active. M0, M2, M3, M4, and M5-1 through M5-4 are complete at their documented implementation checkpoints. M5-5 and M6 remain gated behind M1 exit.

## Production state

A verified Devnet base read model is serving current Vault, Loan Broker, and Loan data through the public current-state API path.

The active published base is fixed to validated Devnet ledger `3371675` and contains:

- 797,550 Vault records;
- 528,228 Loan Broker records;
- 226,725 Loan records;
- 1,552,503 total current-state records.

The incremental history implementation exists, but scheduled production continuation, D1 current-state overlay persistence, tombstone handling, base-plus-overlay API resolution, catch-up from the base ledger, and continuous monitoring evidence are not complete. Mainnet remains disabled.

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

## Resource decision

A 500-page local Devnet sample decoded 1,024,000 ledger objects and stored 67,407 Lending objects. The measured D1 growth and projection placed the row-per-object full current-state snapshot design outside the project's documented 350 MB safety envelope.

The D1-only full-snapshot path therefore stopped before remote current-state migration. The active architecture is now a complete immutable verified base read model plus bounded D1 incremental history and current-state overlay.

The earlier D1-only migration work remains useful as integrity, rollback, resume, immutability, and resource evidence, but it is not the active production current-state storage plan.

## Active unit

The active implementation sequence is:

1. documentation and dependency realignment;
2. D1 incremental overlay and tombstone schema;
3. incremental current-projection integration;
4. base-plus-overlay API integration;
5. scheduled incremental collector wiring;
6. catch-up rehearsal and reconciliation;
7. bounded production catch-up from the ledger after the active base;
8. continuous Devnet monitoring verification;
9. M1 exit review.

The current API resolution rule is being formalized as:

- overlay upsert overrides the base object;
- deletion tombstone hides the base object from current routes;
- no overlay record falls back to the verified base.

## Next order

1. Merge the architecture, decision, resource, status, and roadmap realignment.
2. Add bounded D1 current-state overlay records, tombstones, base identity binding, watermark state, and indexes.
3. Persist overlay changes at the same canonical boundary as history and cursor movement.
4. Merge base and overlay semantics into Overview, entity list/detail, Search, Account, and relationship reads.
5. Connect bounded incremental processing to the scheduled Worker path.
6. Rehearse interruption, resume, replay, gap rejection, and reconciliation.
7. Start bounded production catch-up from the ledger after the active base ledger.
8. Verify newly created, modified, paid, impaired, defaulted, and deleted objects through real Devnet continuation.
9. Complete M1 exit review, then M5-5 and M6.

## Blockers

- No D1 current-state overlay schema is active.
- Incremental persistence does not yet write current-state overlay upserts or deletion tombstones.
- Current API routes do not yet merge the verified base with D1 incremental state.
- The scheduled Worker path does not yet run the incremental ledger collector.
- Production catch-up from the active base ledger has not started.
- Continuous monitoring, reconciliation, M5-5, and M6 evidence remain incomplete.

## Public-information boundary

This status document records product architecture, verified evidence, implementation state, resource decisions, and release blockers only. It does not publish credentials, provider account details, workflow run identifiers, internal incident narratives, private operational constraints, or unrelated project context.