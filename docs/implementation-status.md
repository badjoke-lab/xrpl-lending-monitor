# Implementation status

Last updated: 2026-07-03.

## Current phase

M0, M2, M3, M4-0 through M4-7, and M5-1 through M5-4 are complete.

The active dependency is M1 D1-only closeout. The canonical sequence is defined in [`d1-migration-plan.md`](d1-migration-plan.md) and summarized in `development-roadmap.md`.

M5-5 remains deferred until real current-state data is active and verified. M6 follows M5-5.

## Production state

The public Devnet Worker is deployed and the baseline schema through migration `0008_balance_history.sql` is present.

Current public behavior:

- `/api/status` returns a successful response with the collector uninitialized;
- `/api/overview` returns an explicit active-snapshot unavailable state;
- `/api/activity?limit=6` returns a successful empty indexed-data response;
- current Vault, Loan Broker, and Loan facts remain unavailable because no complete snapshot has been verified and activated.

No current-state snapshot has been created or activated. Migration `0009_d1_current_state_snapshots.sql` has not been applied remotely. Mainnet remains disabled.

## Accepted current-state storage direction

The earlier external object-storage design is superseded. The accepted target is D1-only versioned current-state storage with:

- one runtime D1 binding, `DB`, for history and current-state data;
- one fixed validated Devnet ledger per bootstrap;
- exact opaque marker resume;
- immutable inactive snapshot rows during construction;
- deterministic object and batch hashes;
- complete manifest and relationship verification;
- an atomic active-snapshot pointer switch;
- preservation of the previous active snapshot on failure;
- one retained rollback snapshot;
- cleanup limited to explicitly eligible failed or superseded attempts;
- bounded queries, batches, and rows under the measured D1 resource envelope;
- separate operator actions for bootstrap, verification, measurement, activation, rollback, and cleanup.

This is an accepted design direction, not a claim that the production migration or bootstrap has already occurred.

## Active pull requests and disposition

### Documentation and dependency lock

The current documentation unit must merge first. It adds the canonical D1 migration plan and aligns the roadmap, implementation status, and decision record.

### PR #50 — Snapshot retention safeguards

Status: open and next implementation unit after the documentation lock.

Required before merge:

- real local D1 integration tests;
- verified-manifest and same-epoch restore requirements;
- guarded active and rollback pointer update result checking;
- guarded `sync_state` restoration;
- full protected-snapshot and eligibility-time cleanup tests;
- documentation alignment with the canonical D1 plan.

### PR #49 — Current state binding

Status: open but not merge-ready in its current form.

The branch currently adds a second D1 alias named `CURRENT_STATE`. The accepted D1-only architecture instead uses the existing `DB` binding directly for current entity reads. PR #49 must be revised after PR #50 merges and must not preserve the former object-storage boundary through a duplicate D1 binding.

## Immediate implementation order

1. Merge the documentation and dependency lock.
2. Complete and merge PR #50 snapshot retention safeguards.
3. Revise and merge PR #49 as the single-`DB` runtime binding unit.
4. Complete the D1-only local integration path and isolate superseded R2 paths.
5. Add the non-public operator bootstrap and measurement harness.
6. Run a complete local Devnet bootstrap and the 350 MB resource gate.
7. Stop for review before any remote D1 mutation.
8. Apply reviewed additive migration changes remotely.
9. Run and verify an inactive production Devnet snapshot.
10. Activate explicitly, prove rollback, start incremental collection, complete M5-5, and continue M6.

## Release blockers

- PR #50 retention safeguards are not complete.
- PR #49 still represents the D1 database through a duplicate legacy binding.
- no complete local D1-only bootstrap and resource report exists;
- no reviewed operator execution path exists;
- migration `0009` is not applied remotely;
- no production snapshot is verified or active;
- incremental collection has not started from an active snapshot;
- M5-5 real-data integration and M6 soak evidence are incomplete.

## Public boundaries

- Devnet only.
- Read-only public API.
- No public bootstrap, migration, activation, rollback, cleanup, or other write route.
- No wallet, signing, transaction submission, lending actions, payments, pricing, fiat conversion, cross-asset totals, or proprietary risk scores.
- XRP, IOU, and MPT remain distinct.
- Missing data is not zero.
