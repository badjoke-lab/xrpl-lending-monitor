# Resource envelope

Last updated: `2026-08-06`.

## Purpose

This document defines the measurable runtime, storage, scheduler, network, query, no-charge, and operator envelope for XRPL Lending Monitor.

The collector core remains provider-neutral. Provider limits, unavailable counters, directional accounting, conservative reserves, and profile-specific stop thresholds are deployment-profile facts rather than permanent product architecture.

## Operating principles

- no fixed ledger count is accepted as a complete resource budget;
- every scan is bounded by transactions, bytes, requests, CPU, and wall time;
- every commit is bounded by storage operations, rows, and bytes;
- finalization is one bounded atomic transaction;
- partial work is invisible and cannot advance a cursor;
- a heavy ledger may span multiple commit phases;
- the scheduler preserves one-owner serialization, bounded retry, lease reclaim, and duplicate convergence;
- the selected profile has no mandatory paid runtime dependency or automatic paid overage;
- project guards halt before provider hard limits or billable exposure;
- complete state remains exportable and restorable;
- missing provider counters remain missing and are not relabeled as measured evidence;
- partial heap or external-memory counters do not substitute for unavailable total-memory evidence;
- billable egress and memory/transport may use different byte-direction contracts, but neither may omit a safety-relevant byte;
- profile deployment, rollback, checkpoint, export, restore, evidence, halt, and credential rotation remain scriptable.

## Current architecture

The active current-state architecture remains:

1. one complete verified immutable base read model; plus
2. bounded committed incremental history and current-state overlay in the selected hot store.

Only rows owned by committed work are visible. Every overlay version is bound to network, epoch, base identity, object identity, source ledger or transaction, and owning work.

The rejected row-per-object complete live snapshot layout projected approximately 5.03 GB for one complete current snapshot and 10.10 GB for active plus rollback plus reserve. It remains superseded.

## Runtime contract

A scan phase reads from the committed cursor plus one, selects an adaptive contiguous range, caps requests, transactions, bytes, CPU, and wall time, verifies parent-hash continuity, derives every semantic class, and advances no public state.

A commit phase loads one staged chunk, caps storage operations, rows, and bytes, writes candidate rows by `work_id`, records idempotent completion, and advances no cursor or public watermark.

Finalization atomically verifies all chunks, ledger and hash identity, network, epoch, base identity, semantic counts, payload digests, current and history ownership, and absence of an earlier unresolved work. Only finalization may commit work and advance public watermarks.

Reference commit guards remain:

- at most 40 storage operations per invocation;
- at most 40 canonical row mutations per invocation;
- at most 512,000 encoded bytes per payload chunk;
- at most 16,000 bytes per scheduler message.

## Selected deployment profile

R4E selected the currently deployed identity:

- profile: `supabase_free_postgres_pgcron_edge`;
- revision: `3`;
- profile identity digest: `3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67`;
- R4E selection digest: `13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667`;
- network: `devnet`.

Revision 3 remains the identity of the clean halted R5 state. It correctly applies fail-closed pre-reservation and does not claim unavailable provider counters. Its recovery egress formula is now rejected as a convergence path, not as a safety mechanism.

## Fixed selected guardrails

The following boundaries remain in force during R4F qualification:

| Resource | Project halt or reservation | Provider or runtime boundary |
| --- | ---: | ---: |
| Project memory | 224 MiB | 256 MiB provider hard boundary |
| Rolling application egress, 31 days | 4 GiB | 5 GiB Free-plan boundary |
| Revision-3 recovery reservation | 128 MiB | deducted before mutation |
| Project invocations, 31 days | 400,000 | 500,000 Free-plan boundary |
| Database size | 400,000,000 bytes | 500,000,000 bytes |
| Database connections | 45 | 60 |
| Edge wall time | 45,000 ms | 150,000 ms |
| Deployed bundle | 4,000,000 bytes | 5,000,000 bytes |
| Memory-qualified ledgers per claim | 12 | 24 remains unqualified |

No R4F work changes the selected runtime until G10 explicitly selects a new identity.

## Throughput qualification

The retained R4 execution results remain:

- steady minute rates: `[24, 24, 24, 24, 24, 24]`;
- steady p95: `24/min`;
- isolated catch-up p95: `14,178.400673920027/min`.

These results prove execution throughput when resource headroom is available. They do not prove rolling egress convergence.

## Current R5 state

Issue `#1175` controls the halted R5 recovery.

Read-only diagnostic run `31032129918` observed:

- status/error: `halted / r5_recovery_monthly_egress_halt`;
- completed batches: `297`;
- committed ledgers: `5,811`;
- recovery/physical watermarks: `4,139,118 / 4,139,122`;
- active batches: `0`;
- noncommitted work: `0`;
- database bytes: `276,958,355`.

The boundary is clean: no active batch, partial commit, or recent batch error remains.

## Revision-3 rolling calculation

Read-only diagnostic run `31034105841` retained:

| Value | Bytes |
| --- | ---: |
| Attempt conservative bytes | 1,286,596,364 |
| Legacy tick conservative bytes | 577,242,176 |
| Selected steady conservative bytes | 1,286,596,364 |
| R5 recovery conservative bytes | 2,880,972,004 |
| Prior conservative bytes | 4,167,568,368 |
| One new reservation | 134,217,728 |
| Projected conservative bytes | 4,301,786,096 |
| Fixed rolling halt | 4,294,967,296 |
| Headroom after reservation | -6,818,800 |

The next claim was correctly denied before mutation.

`2026-09-03T10:46:04.042Z` is a one-reservation eligibility estimate under revision-3 accounting only. It does not authorize a restart.

## R5C2 attribution

Read-only run `31068546022` retained:

| Class | Value |
| --- | ---: |
| Executor batches | 231 |
| Adopted zero-egress batches | 66 |
| Executor ledgers | 5,076 |
| Adopted ledgers | 735 |
| Recovery conservative bytes | 2,880,972,004 |
| Deterministic conservative floor | 2,302,894,080 |
| Variable conservative bytes | 578,077,924 |
| Retained normalized payload bytes | 5,753,011 |

The attribution reconciles exactly. Three repaired completed batches retained a full 128 MiB failure reservation; no noncompleted batch remains.

The retained schema does not preserve exact per-direction network bytes or the original accounting JSON. Those missing surfaces drive revision-4 G2 instrumentation requirements.

## Revision-3 convergence rejection

Excluding repair-only rows, normal completed work averages approximately `494,083` conservative bytes per ledger. The fixed 4 GiB rolling halt permits approximately `0.195` ledger/minute at that cost.

The memory-qualified future 12-ledger shape averages approximately `882,493` conservative bytes per ledger and permits approximately `0.109` ledger/minute.

The required steady rate is `21` ledgers/minute. A 31-day window therefore requires `937,440` ledgers and an average complete billable-direction upper bound of no more than approximately `4,582` bytes per ledger before intervention headroom.

Even deleting the entire deterministic floor while retaining the observed normal variable remainder permits only approximately `2.35` ledgers/minute.

Consequences:

- anomaly removal is insufficient;
- reservation tuning is insufficient;
- 24-ledger restoration is memory-unqualified and insufficient;
- invocation splitting is insufficient;
- a one-time rebase without steady convergence is insufficient;
- revision-3 continuation is rejected.

The controlling evaluation is [`ops/r5-egress-candidate-evaluation-2026-08-06.md`](ops/r5-egress-candidate-evaluation-2026-08-06.md).

## Revision-4 candidate contract

Issue `#1261` controls R4F qualification.

Candidate identity:

- profile: `supabase_free_postgres_pgcron_edge`;
- revision: `4`;
- identity digest: `39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5`;
- selection: `not_selected`;
- recovery mutation authorized: `false`.

Revision 4 keeps two independent upper bounds.

### Rolling billable-egress upper bound

Include:

- documented outbound data sent from Supabase to connected clients;
- external outbound requests conservatively until G3 reconciliation;
- unresolved internal database and function-to-function classes conservatively until G3;
- source-backed framing and unexplained-delta reserves.

Exclude inbound external responses from this rolling sum. Do not use a blanket multiplier over all network directions.

### Memory and transport upper bound

Include every relevant direction and representation:

- inbound and outbound body bytes;
- database and function-to-function bytes;
- canonical JSON and payload serialization;
- ledger, transaction, metadata, normalized-record, payload-chunk, and relationship overhead;
- failed, retried, repaired, and adopted state;
- framing, allocator, and unexplained-delta reserves.

Inbound XRPL responses remain fully counted here even though they are excluded from rolling billable egress.

The machine-readable and human-readable G1 contract is documented in [`ops/r4f-revision4-directional-egress-contract-2026-08-06.md`](ops/r4f-revision4-directional-egress-contract-2026-08-06.md).

## R4F qualification order

1. G1 contract lock;
2. G2 directional instrumentation and retained accounting JSON;
3. G3 isolated provider reconciliation and unexplained-delta reserve;
4. G4 memory requalification;
5. G5 steady convergence at or above 21 ledgers/minute;
6. G6 moving-head catch-up convergence;
7. G7 failure, retry, repair, and adoption accounting;
8. G8 export, restore, continuation, rollback, and operator independence;
9. G9 one separately authorized bounded proof unit;
10. G10 selection or rejection.

## Automatic guardrails

- stop before execution deadline margins and hard ceilings;
- reserve before mutation;
- never advance a cursor or watermark for incomplete work;
- cap ledgers, transactions, retries, bytes, operations, rows, and mutations;
- reject network, epoch, base, parent-hash, digest, checkpoint, or identity mismatch;
- preserve one-owner serialization and deterministic successor behavior;
- keep unavailable provider surfaces explicit;
- preserve scripted rollback, halt, credential rotation, export, restore, and evidence publication;
- do not lower a fixed guard to make a workload pass;
- do not restart when rolling headroom first becomes positive.

## Storage and publication rules

- prohibit unbounded full-table API scans;
- query only committed rows bound to active network, epoch, and base identity;
- preserve indexed pagination and deterministic export and restore;
- never advance a cursor after partial persistence;
- never accept state for the wrong source identity;
- publish immutable history from committed work only;
- advance publication watermarks only after independent verification;
- compact hot state only after publication succeeds;
- preserve the public reader unchanged until a separately authorized cutover.

## Runtime selection rule

A profile may be selected only after production-shaped evidence demonstrates safety margin for cadence, CPU, memory, network, scheduler operations, storage, query volume, export, restore, reconciliation, catch-up, no-charge operation, and operator independence.

A changed accounting or execution contract creates a new identity and must pass the complete qualification sequence.

Revision 4 may be selected only after G1-G10 prove both no-charge safety and moving-head convergence under unchanged or stricter fixed guards.

## Operating restrictions

- Do not restart R5 under revision 3.
- Do not run a revision-3 proof burst.
- Do not treat execution throughput as rolling-window convergence.
- Do not describe application accounting as exact provider egress.
- Do not reduce the 4 GiB rolling halt, 224 MiB memory halt, invocation limits, or 12-ledger cap to make a candidate pass.
- Do not exclude inbound bytes from memory or transport accounting.
- Do not create production recovery work solely to measure resource use.
- Do not split the same total bytes across more runs and call that a reduction.
- Do not skip ledgers or replace continuity with latest-state-only collection.
- Do not rebase without a fixed validated ledger, complete manifest, relationship, identity, and continuation proof.
- Do not switch the public reader, enable Mainnet, start stabilization, or start soak during R4F qualification.
