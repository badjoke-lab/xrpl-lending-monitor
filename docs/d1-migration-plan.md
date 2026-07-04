# D1 current-state migration plan

Status: superseded.
Last updated: 2026-07-04.

This document records the evaluated D1-only full current-state snapshot approach. It is retained as architecture and resource history. It no longer controls active M1 implementation order.

The active execution plan is [`development-roadmap.md`](development-roadmap.md). The replacement architecture is defined by `architecture.md`, `collector-design.md`, `resource-envelope.md`, and decision D-022 in `decision-log.md`.

## Historical design

The evaluated design required:

- one runtime D1 binding, `DB`;
- complete current-state snapshot rows in D1;
- separate bootstrap, verification, activation, rollback, and cleanup operations;
- one fixed validated Devnet ledger index and hash per bootstrap;
- exact marker advancement only after durable bounded writes;
- immutable completed snapshots;
- complete manifest and relationship verification before activation;
- one retained verified rollback snapshot;
- incremental collection only after a verified active snapshot existed;
- Mainnet disabled.

These integrity rules remain useful, but the complete row-per-object D1 layout was rejected by measured resource evidence.

## Evaluation result

The public Devnet Worker and schema through `0008_balance_history.sql` were deployed before the evaluation.

Migration `0009_d1_current_state_snapshots.sql` was evaluated locally but is not part of the active production current-state plan.

A 500-page local Devnet sample decoded 1,024,000 ledger objects and persisted 67,407 Lending objects in the evaluated row-per-object layout. Local D1 grew by 218,869,760 bytes.

Projection was approximately:

- 5.03 GB for one complete row-per-object current snapshot;
- 10.10 GB for active plus rollback plus reserve.

This exceeded the project safety envelope. The D1-only full-snapshot path stopped before remote current-state migration.

## Completed evaluation units

### D1-0 — Documentation and dependency lock

Completed.

### D1-1 — Snapshot retention safeguards

Completed locally. The evaluation covered guarded restore, rollback pointer handling, sync-state restoration, and cleanup protections.

### D1-2 — Single D1 runtime binding

Completed. The `DB` binding remains the D1 runtime boundary for history and incremental overlay state under the replacement architecture.

### D1-3 — D1-only local integration closeout

Completed locally. The evaluation covered bounded write, interruption, exact-marker resume, verification, activation, read, rollback, cleanup, retry idempotency, changed-ledger rejection, and relationship checks.

### D1-4 — Operator bootstrap and measurement harness

Completed locally. The harness separated status, bootstrap or resume, verify, measure, activate, restore, and cleanup operations and produced the resource evidence used in the storage decision.

### D1-5 — Complete local Devnet bootstrap and resource gate

Completed as a measured evaluation. The full row-per-object D1 layout did not pass the production resource gate.

## Cancelled production units

### D1-6 — Remote additive current-state migration

Status: cancelled by D-022.

Migration `0009_d1_current_state_snapshots.sql` is not the active production current-state storage path.

### D1-7 — Production D1 full-snapshot bootstrap

Status: cancelled by D-022.

The replacement architecture publishes a complete verified immutable base read model instead of duplicating the entire base state into D1.

### D1-8 — D1 full-snapshot activation and rollback proof

Status: cancelled as a production path by D-022.

Equivalent integrity goals continue through verified immutable base publication, active channel resolution, previous-base preservation, and base identity checks.

### D1-9 — Incremental continuation after D1 snapshot activation

Status: replaced by the active M1 sequence.

Incremental continuation now begins after a verified base read model exists and writes bounded D1 historical evidence plus current-state overlay upserts and deletion tombstones.

## Retained guarantees

The evaluation established requirements that remain active where applicable:

- fixed-ledger bootstrap identity;
- exact marker resume;
- bounded work;
- deterministic hashing;
- manifest verification;
- relationship validation;
- idempotent retry;
- immutable complete outputs;
- explicit activation boundaries;
- cleanup safeguards;
- resource measurement before production use.

## Active replacement order

The current M1 dependency order is:

1. documentation and dependency realignment;
2. D1 incremental overlay and tombstone foundation;
3. incremental current-projection integration;
4. base-plus-overlay API integration;
5. scheduled incremental collector wiring;
6. catch-up rehearsal and reconciliation;
7. bounded production catch-up from the ledger after the active base;
8. continuous Devnet monitoring verification;
9. M1 exit review;
10. M5-5 and M6.

See [`development-roadmap.md`](development-roadmap.md) for target dates and exit conditions.