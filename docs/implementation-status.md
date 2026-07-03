# Implementation status

Last updated: 2026-07-03.

## Current phase

M1 D1-only closeout is active under [`d1-migration-plan.md`](d1-migration-plan.md). M0, M2, M3, M4, and M5-1 through M5-4 are complete.

## Production state

The public Devnet Worker is deployed through migration `0008_balance_history.sql`. Migration `0009_d1_current_state_snapshots.sql` is not applied remotely. No current-state snapshot is verified or active. Current entity routes report unavailable. Mainnet remains disabled.

## Completed D1 units

- PR #53 / D1-0: canonical plan and dependency order.
- PR #54 / D1-1: rollback and cleanup safeguards.
- PR #55 / D1-2: one runtime D1 binding, `DB`.
- PR #56 / D1-3: local D1 pause, resume, verification, activation, reads, rollback, and cleanup integration.
- PR #57 / D1-4: separate local D1 actions and measurement evidence.
- PR #59: up to 2,048 decoded objects per RPC page with D1 writes bounded to 80 relevant objects.
- PR #49 and PR #50 were closed as superseded.

## Active D1 preparation unit

### PR #60 — Retained-snapshot capacity gate

The branch adds a local `capacity` action that:

- requires a verified manifest-backed snapshot;
- reads the current local D1 size from D1 query metadata;
- measures manifest, object, batch, maximum-row, and maximum-batch evidence;
- adds only the retained snapshot generations not already present in the current database;
- adds an explicit history reserve;
- rejects projections above the 350 MB bootstrap stop threshold;
- emits the JSON evidence before returning exit status `2` when enforcement rejects the projection.

This closes the capacity-check prerequisite for the D1-5 complete local Devnet bootstrap.

## Next order

1. Complete and merge PR #60.
2. Run a complete local Devnet bootstrap and generate the retained-snapshot capacity report.
3. Verify and activate locally, build a second snapshot, rerun the gate with both generations included, and prove rollback.
4. Review all D1-5 evidence before any remote schema mutation.
5. Apply the reviewed additive migration.
6. Build and verify an inactive production snapshot.
7. Activate separately, prove rollback, and start incremental collection.
8. Complete M5-5 and continue M6.

## Blockers

- PR #60 is not merged.
- No complete real Devnet local bootstrap report exists.
- Migration `0009` is not applied remotely.
- No production snapshot is verified or active.
- Incremental collection, M5-5, and M6 evidence remain incomplete.
