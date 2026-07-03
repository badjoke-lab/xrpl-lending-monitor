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
- PR #49 and PR #50 were closed as superseded.

## Active D1 unit

### PR #57 / D1-4 — Local D1 tools

The branch adds separate local actions for status, bounded bootstrap, verification, measurement, activation, rollback, cleanup eligibility, and eligible-attempt removal.

It also adds fixed-ledger validation, execution caps, marker redaction, machine-readable evidence, capacity measurements, and CI build coverage for the Node-targeted command bundle.

## Next order

1. Complete PR #57.
2. Run a complete local Devnet bootstrap and the 350 MB gate.
3. Review the local evidence.
4. Apply the reviewed additive schema change.
5. Build and verify an inactive production snapshot.
6. Activate separately, prove rollback, and start incremental collection.
7. Complete M5-5 and continue M6.

## Blockers

- PR #57 is not merged.
- No complete real Devnet local bootstrap report exists.
- Migration `0009` is not applied remotely.
- No production snapshot is verified or active.
- Incremental collection, M5-5, and M6 evidence remain incomplete.
