# D1 current-state migration plan

Last updated: 2026-07-03.

This document is the canonical execution plan for closing M1 and moving XRPL Lending Monitor from the superseded external-object-storage current-state path to verified D1-only current-state snapshots.

## Non-negotiable design

- The public Worker uses one D1 binding, `DB`, for network state, history, current-state snapshots, manifests, checkpoints, active pointers, and current-object reads.
- No second D1 alias is added solely to preserve the former `CURRENT_STATE` object-storage boundary.
- Bootstrap is an explicitly initiated operator process, not a public HTTP route and not a page-traffic side effect.
- Bootstrap, verification, and activation are separate operations.
- One bootstrap attempt is fixed to one validated Devnet ledger index and hash.
- The exact opaque marker advances only after the matching bounded D1 batch is durable.
- Completed snapshots are immutable.
- An incomplete, relationship-invalid, count-invalid, or digest-invalid snapshot never becomes active.
- Activation changes only the verified active pointer and retains one verified rollback snapshot.
- Cleanup is limited to explicitly eligible failed or superseded attempts that are neither active nor retained for rollback.
- Incremental collection begins only after a verified active snapshot exists.
- Mainnet remains disabled.

## Current production boundary

The public Devnet Worker and schema through `0008_balance_history.sql` are deployed. Migration `0009_d1_current_state_snapshots.sql`, production D1 bootstrap, verification, activation, and incremental continuation have not occurred.

Until activation, current entity APIs must continue returning explicit unavailable states rather than zero, empty totals, or mock data.

## Execution order

### D1-0 — Documentation and dependency lock

- Align the roadmap, implementation status, decision record, and this plan.
- Record that PRs changing bindings, retention, bootstrap execution, measurement, migration, or activation must follow this order.
- Do not remotely mutate D1 during this unit.

Exit condition: source-of-truth documents agree and are merged before implementation resumes.

### D1-1 — Snapshot retention safeguards

- Verify previous-snapshot restore against a real local D1 schema.
- Require the previous target to be verified, in the active epoch, and backed by a valid manifest.
- Atomically swap active and rollback pointers and restore `sync_state` to the selected snapshot ledger.
- Fail when the guarded pointer update changes no rows.
- Prevent active, rollback, building, resumable, or otherwise protected snapshots from becoming cleanup eligible or being removed.
- Enforce cleanup eligibility time and failed-or-superseded status.

Exit condition: local migration and integration tests prove rollback and cleanup protections; full validation passes.

### D1-2 — Single D1 runtime binding

- Remove the legacy `CURRENT_STATE` runtime binding.
- Pass `DB` to current Vault, Loan Broker, and Loan readers.
- Preserve explicit unavailable behavior when migration `0009` is absent or no verified active snapshot exists.
- Reject unverified, cross-epoch, or relationship-invalid reads.

Exit condition: the Worker uses one D1 binding and all current-state API contracts pass before and after local activation.

### D1-3 — D1-only local integration closeout

- Remove or isolate superseded D1-plus-R2 bootstrap paths from the active product path.
- Prove begin, bounded write, exact-marker resume, verification, activation, read, rollback, and cleanup as one local integration sequence.
- Prove idempotent retry and rejection of changed ledger identity.
- Prove same-snapshot Vault to Loan Broker to Loan relationships.
- Prove incomplete or invalid snapshots cannot activate.

Exit condition: `pnpm check`, local migrations, integration tests, and `pnpm test:e2e` pass on the D1-only path.

### D1-4 — Operator bootstrap and measurement harness

Provide a non-public operator interface with distinct commands or modes for:

- status;
- start or resume bounded bootstrap;
- verify;
- measure;
- activate;
- restore previous snapshot;
- mark cleanup eligibility;
- remove an eligible attempt.

The operator interface must:

- require an explicit fixed ledger index and hash;
- default to no activation;
- cap pages, decoded objects, rows, statements, retries, and execution time;
- emit public-safe machine-readable evidence;
- avoid logging credentials or unnecessary opaque markers;
- record pages, requests, decoded objects, relevant objects, raw and normalized bytes, rows written, query count, maximum row size, maximum batch size, retries, heap, wall time, manifest identity, and projected database use.

Exit condition: a complete local Devnet bootstrap can be interrupted, resumed, verified, measured, activated, read, and rolled back only through explicit operator actions.

### D1-5 — Complete local Devnet bootstrap and resource gate

- Apply migrations `0001` through `0009` to a clean local D1 database.
- Fix one validated Devnet ledger identity.
- Complete every marker through repeated bounded runs.
- Verify object hashes, batch hashes, counts, manifest, and relationships.
- Activate locally and validate all current-state API and UI routes.
- Create or project one additional rollback snapshot.
- Measure history, indexes, active snapshot, rollback snapshot, and headroom.

Remote work stops when projected total D1 use exceeds the documented 350 MB safety threshold or any row, batch, query, write, or latency boundary is unsafe.

Exit condition: the resource report passes and is reviewed before remote migration.

### D1-6 — Remote additive migration

- Read the remote migration state and database size without mutation.
- Apply only migration `0009_d1_current_state_snapshots.sql` and any later reviewed additive migration required by the preceding local units.
- Verify tables, indexes, and absence of unintended current snapshots.
- Verify public current-state APIs still report unavailable before activation.

Exit condition: remote schema is ready and production data remains unchanged except for additive empty structures.

### D1-7 — Production Devnet bootstrap and verification

- Fix one validated Devnet ledger index and hash.
- Construct one inactive snapshot through bounded resumable runs.
- Complete every marker.
- Verify counts, object hashes, batch hashes, manifest, and same-snapshot relationships.
- Record resource evidence and compare it with the local projection.
- Do not activate in the bootstrap command.

Exit condition: one complete production snapshot is verified and inactive.

### D1-8 — Explicit activation and rollback proof

- Activate the verified snapshot through a separate operator action.
- Verify Overview, Vault, Loan Broker, Loan, Search, Account, epoch, and relationship routes against the manifest.
- Prove rollback to the retained previous snapshot when one exists, then restore the intended active snapshot.
- Confirm incomplete-attempt cleanup remains guarded.

Exit condition: real Devnet current data is served from the verified active D1 snapshot and rollback behavior is demonstrated.

### D1-9 — Incremental continuation and M1 exit

- Start the incremental collector from the ledger after the active snapshot ledger.
- Verify contiguous cursor movement, parent-hash continuity, idempotent retry, projection updates, lifecycle, archives, balance history, and reset handling.
- Reconcile bootstrap current state with incremental history.

M1 exits only when the verified active snapshot is serving real data and incremental collection is advancing safely.

### D1-10 — M5-5 and M6

After M1 exit:

- complete cross-audit integration, exports, and real-data browser regression in M5-5;
- run M6 integrity, reset, resource, accessibility, performance, security, operations, and real multi-day soak gates.

## Pull-request dependency order

1. documentation and dependency lock;
2. snapshot retention safeguards;
3. single D1 runtime binding;
4. D1-only local integration closeout;
5. operator bootstrap and measurement harness;
6. local complete bootstrap and resource evidence;
7. reviewed remote migration;
8. production bootstrap and verification;
9. explicit activation and rollback proof;
10. incremental continuation, M5-5, and M6.

Parallel pull requests may be prepared, but they must not merge out of dependency order or rely on an unmerged predecessor.

## Approval boundary

Code, local migrations, tests, non-destructive Devnet reads, and measurement evidence may proceed normally. Remote D1 migration, production bootstrap, and active-pointer mutation are separate reviewed operations and must not be implied by a code merge or web deployment.
