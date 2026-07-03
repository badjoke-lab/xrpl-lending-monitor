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
- PR #49 and PR #50 were closed as superseded.

## Active D1 preparation unit

### PR #59 — Bounded RPC pages and D1 writes

The branch separates the XRPL RPC page boundary from the D1 write boundary:

- up to 2,048 decoded ledger objects per RPC page;
- at most 80 relevant lending objects per D1 write batch;
- the continuation marker advances only after the final batch for the page is durable;
- empty pages still persist one terminal batch so marker progress is durable;
- the operator and command documentation use the same shared limits.

This closes the batching prerequisite for the D1-5 complete local Devnet bootstrap.

## Next order

1. Complete and merge PR #59.
2. Add the current-database and retained-snapshot capacity gate from the superseded PR #52 design to the current main branch.
3. Run a complete local Devnet bootstrap and generate the 350 MB resource report.
4. Review the local evidence before any remote schema mutation.
5. Apply the reviewed additive migration.
6. Build and verify an inactive production snapshot.
7. Activate separately, prove rollback, and start incremental collection.
8. Complete M5-5 and continue M6.

## Blockers

- PR #59 is not merged.
- The complete retained-snapshot capacity gate is not yet on main.
- No complete real Devnet local bootstrap report exists.
- Migration `0009` is not applied remotely.
- No production snapshot is verified or active.
- Incremental collection, M5-5, and M6 evidence remain incomplete.
