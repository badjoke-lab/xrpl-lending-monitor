# Implementation status

Last updated: 2026-07-03.

## Current phase

M0, M2, M3, M4, and M5-1 through M5-4 are complete. M1 D1-only closeout is active. The controlling sequence is [`d1-migration-plan.md`](d1-migration-plan.md).

## Production state

The public Devnet Worker is deployed with migrations through `0008_balance_history.sql`.

- migration `0009_d1_current_state_snapshots.sql` is not applied remotely;
- no current-state snapshot has been created or activated;
- current entity routes correctly report unavailable;
- Mainnet remains disabled.

## Accepted direction

- one runtime D1 binding: `DB`;
- fixed validated Devnet ledger per bootstrap;
- exact-marker resume after durable bounded writes;
- immutable inactive snapshots;
- deterministic hashes, manifest, and relationship verification;
- separate bootstrap, verification, measurement, activation, rollback, and cleanup actions;
- one retained rollback snapshot;
- no public write route.

## Completed D1 units

- **PR #53 / D1-0:** canonical D1 plan and dependency order merged.
- **PR #54 / D1-1:** rollback and cleanup safeguards merged, including local workerd D1 integration coverage.
- PR #50 was closed as superseded by PR #54.

## Active D1 unit

### PR #55 / D1-2 — Single D1 binding

The branch removes the legacy `CURRENT_STATE` binding and uses `DB` for current Vault, Loan Broker, and Loan reads. It also removes the duplicate unavailable Loan route while preserving unavailable responses before a verified active snapshot exists.

PR #49 was closed because it retained a second alias to the same D1 database.

## Next order

1. Merge PR #55 after full validation.
2. Complete D1-only local integration and isolate the superseded R2 path.
3. Add the non-public operator and measurement harness.
4. Complete a local Devnet bootstrap and the 350 MB resource gate.
5. Review before remote schema work.
6. Apply the additive migration, build and verify an inactive production snapshot, then activate separately.
7. Start incremental collection, complete M5-5, and continue M6.

## Current blockers

- PR #55 is not merged;
- the old R2 bootstrap path is not yet isolated;
- no complete local bootstrap resource report exists;
- no production snapshot is verified or active;
- incremental collection, M5-5, and M6 evidence remain incomplete.
