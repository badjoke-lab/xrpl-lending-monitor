# Implementation status

Last updated: 2026-07-03.

## Current phase

M0, M2, M3, M4-0 through M4-7, and M5-1 through M5-4 are complete.

The active dependency is M1 closeout: replace the superseded external-object-storage current-state path with the accepted D1-only snapshot design, run complete local validation, measure the resource envelope, then obtain approval before any remote schema change, production bootstrap, or snapshot activation.

M5-5 remains deferred until real current-state data is active and verified. M6 follows M5-5.

## Production state

The public Devnet Worker is deployed and the baseline schema through migration `0008_balance_history.sql` is present.

Current public behavior:

- `/api/status` returns a successful response with the collector uninitialized;
- `/api/overview` returns an explicit active-snapshot unavailable state;
- `/api/activity?limit=6` returns a successful empty indexed-data response;
- current Vault, Loan Broker, and Loan facts remain unavailable because no complete snapshot has been verified and activated.

No current-state snapshot has been created or activated. Mainnet remains disabled.

## Accepted current-state storage direction

The earlier external object-storage design is superseded. The accepted target is D1-only versioned current-state storage with:

- one fixed validated Devnet ledger per bootstrap;
- exact opaque marker resume;
- immutable inactive snapshot rows during construction;
- deterministic object and batch hashes;
- complete manifest and relationship verification;
- an atomic active-snapshot pointer switch;
- preservation of the previous active snapshot on failure;
- one retained rollback snapshot;
- cleanup limited to explicitly eligible incomplete attempts;
- bounded queries, batches, and rows under the measured D1 resource envelope.

This is an accepted design direction, not a claim that the production migration or bootstrap has already occurred.

## Next implementation order

1. Finalize the additive D1-only schema and storage contracts.
2. Replace the bootstrap write path with bounded D1 inactive-snapshot writes.
3. Replace current-object readers with active D1 snapshot queries.
4. Add deterministic activation, rollback, cleanup, interruption, and relationship tests.
5. Measure object count, normalized bytes, database estimate, index overhead, rows written, query counts, and active-plus-rollback headroom.
6. Run the full local quality and browser test set.
7. Stop for review before any remote migration or production bootstrap.
8. After verified activation, start and verify incremental collection, complete M5-5, then continue M6.

## Public boundaries

- Devnet only.
- Read-only public API.
- No wallet, signing, transaction submission, lending actions, payments, pricing, fiat conversion, cross-asset totals, or proprietary risk scores.
- XRP, IOU, and MPT remain distinct.
- Missing data is not zero.
