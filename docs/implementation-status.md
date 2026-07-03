# Implementation status

Last updated: 2026-07-03.

## Current phase

M1 current-state storage evaluation is active. M0, M2, M3, M4, and M5-1 through M5-4 are complete.

## Production state

The public Devnet Worker is deployed through migration `0008_balance_history.sql`. Migration `0009_d1_current_state_snapshots.sql` is not applied remotely. No current-state snapshot is verified or active. Current entity routes report unavailable. Mainnet remains disabled.

## Completed units

- PR #53: D1 evaluation plan and dependency order.
- PR #54: rollback and cleanup safeguards.
- PR #55: one runtime D1 binding, `DB`.
- PR #56: local pause, resume, verification, activation, reads, rollback, and cleanup integration.
- PR #57: separate local operator actions and measurement evidence.
- PR #59: 2,048 decoded objects per RPC page with writes bounded to 80 relevant objects.
- PR #60: retained-snapshot capacity gate using actual local D1 size metadata.
- PR #62: canonical compressed page-local data shards, digests, manifests, and local artifact storage.
- PR #63: deterministic compressed object-ID, account, relationship, and search indexes.
- PR #64: one page manifest and checkpoint advancement only after durable artifact verification.
- PR #65: scanner integration with resumable artifact checkpoints and no automatic activation.

## Capacity result

A 500-page local Devnet sample decoded 1,024,000 ledger objects and stored 67,407 Lending objects. Local D1 grew by 218,869,760 bytes.

The measured rate projects approximately 5.03 GB for one complete row-per-object snapshot and 10.10 GB for active plus rollback plus reserve. This exceeds the 350 MB project threshold, so the D1 row-per-object current-state layout will not proceed to remote migration.

## Active unit

The `snapshot-level-manifest` branch adds complete-snapshot verification over page manifests:

- requires a complete bootstrap checkpoint;
- requires contiguous page sequences and matching page counts;
- reloads every page manifest from the artifact store;
- verifies each page-manifest digest and snapshot identity;
- aggregates object, index-entry, compressed-byte, and uncompressed-byte totals;
- emits one deterministic snapshot-level manifest;
- verifies the stored snapshot manifest before returning it;
- tests deterministic output, incomplete-checkpoint rejection, and digest mismatch rejection.

## Next order

1. Pass full CI and merge the snapshot-level manifest unit.
2. Add a persistent local checkpoint adapter without applying remote schema.
3. Add a complete local Devnet measurement runner and evidence output.
4. Implement bounded readers for list, detail, account, relationship, and search paths.
5. Select and validate a production storage adapter only after local capacity and read-path evidence pass.
6. Build and verify an inactive production snapshot.
7. Activate separately, prove rollback, and start incremental collection.
8. Complete M5-5 and continue M6.

## Blockers

- The snapshot-level manifest unit is not merged.
- A persistent checkpoint adapter is not implemented.
- No complete compressed Devnet capacity report exists.
- Migration `0009` remains unapplied remotely.
- No production snapshot is verified or active.
- Incremental collection, M5-5, and M6 evidence remain incomplete.
