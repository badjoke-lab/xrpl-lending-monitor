# Implementation status

Last updated: 2026-07-03.

## Current phase

M1 D1-only closeout is active. The controlling sequence is [`d1-migration-plan.md`](d1-migration-plan.md). M0, M2, M3, M4, and M5-1 through M5-4 are complete.

## Production state

The public Devnet Worker is deployed through migration `0008_balance_history.sql`. Migration `0009_d1_current_state_snapshots.sql` is not applied remotely. No current-state snapshot is verified or active. Current entity routes correctly report unavailable. Mainnet remains disabled.

## Completed D1 units

- PR #53 / D1-0: canonical plan and dependency order.
- PR #54 / D1-1: rollback and cleanup safeguards with local D1 coverage.
- PR #55 / D1-2: one runtime D1 binding, `DB`.
- PR #49 and PR #50 were closed as superseded.

## Active D1 unit

### PR #56 / D1-3 — Local integration

The branch removes the old D1-plus-R2 bootstrap export and validates pause, exact-marker resume, changed-ledger rejection, verification, activation, current reads, two-snapshot rollback, and guarded failed-attempt cleanup against local D1.

## Next order

1. Complete PR #56.
2. Add the non-public operator and measurement harness.
3. Complete a local Devnet bootstrap and the 350 MB resource gate.
4. Review before remote schema work.
5. Apply the additive migration, verify an inactive production snapshot, then activate separately.
6. Start incremental collection, complete M5-5, and continue M6.

## Blockers

- PR #56 is not merged.
- No operator and resource report exists.
- No production snapshot is verified or active.
- Incremental collection, M5-5, and M6 evidence remain incomplete.
