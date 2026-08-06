# Resource envelope

Last updated: `2026-08-06`.

## Purpose

This document defines the measurable runtime, storage, scheduler, network, query, no-charge, and operator envelope for XRPL Lending Monitor.

The collector core remains provider-neutral. Provider limits, unavailable counters, conservative application accounting, and profile-specific stop thresholds are deployment-profile facts rather than permanent product architecture.

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
- a missing provider counter remains missing and is not relabeled as measured evidence;
- partial heap or external-memory counters do not substitute for unavailable total-memory evidence;
- conservative application-owned accounting may be used as an explicit profile contract when the provider surface is unavailable;
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

R4E selected:

- profile: `supabase_free_postgres_pgcron_edge`;
- revision: `3`;
- profile identity digest: `3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67`;
- R4E selection digest: `13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667`;
- network: `devnet`.

Revision 3 replaced the rejected revision-2 treatment of unavailable provider memory and egress counters with a new, explicit profile identity using conservative application-owned accounting and fail-closed pre-reservation.

Selection means the profile's G1-G10 qualification passed under that exact contract. It does not mean every possible recovery workload is guaranteed to converge inside the rolling resource window.

## Fixed revision-3 guardrails

The selected contract retains, at minimum:

| Resource | Project halt or reservation | Provider or runtime boundary |
| --- | ---: | ---: |
| Project memory | 224 MiB | 256 MiB provider hard boundary |
| Rolling application egress, 31 days | 4 GiB | profile stop boundary |
| One recovery reservation | 128 MiB | deducted before mutation |
| Project invocations, 31 days | 400,000 | 500,000 Free-plan boundary |
| Database size | 400,000,000 bytes | 500,000,000 bytes |
| Database connections | 45 | 60 |
| Edge wall time | 45,000 ms | 150,000 ms |
| Deployed bundle | 4,000,000 bytes | 5,000,000 bytes |

A claim is denied before mutation when its reservation would cross a fixed project halt.

## Throughput qualification

The retained R4 throughput results remain:

- steady minute rates: `[24, 24, 24, 24, 24, 24]`;
- steady p95: `24/min`;
- isolated catch-up p95: `14,178.400673920027/min`.

These results prove the measured execution design can exceed the required steady rate of 21 ledgers/minute and catch-up rate of 30 ledgers/minute when resource headroom is available. They do not by themselves prove rolling-window convergence for the full R5 backlog.

## Current R5 resource state

Issue `#1175` is the controlling R5 recovery issue.

Read-only diagnostic run `31032129918` observed:

- recovery status: `halted`;
- last error: `r5_recovery_monthly_egress_halt`;
- completed batches: `297`;
- committed ledgers: `5,811`;
- recovery watermark: `4,139,118`;
- physical watermark: `4,139,122`;
- active batches: `0`;
- noncommitted work: `0`;
- database bytes: `276,958,355`.

The halted state is clean: no active batch, no noncommitted work, and no recent batch error remains.

## Current rolling egress calculation

Read-only diagnostic run `31034105841` retained:

| Value | Bytes |
| --- | ---: |
| Attempt conservative bytes | 1,286,596,364 |
| Legacy tick conservative bytes | 577,242,176 |
| Steady conservative bytes | 1,286,596,364 |
| R5 recovery conservative bytes | 2,880,972,004 |
| Prior conservative bytes | 4,167,568,368 |
| One new reservation | 134,217,728 |
| Projected conservative bytes | 4,301,786,096 |
| Fixed rolling halt | 4,294,967,296 |
| Headroom after reservation | -6,818,800 |

The next claim was correctly denied before mutation.

The calculated first release time, assuming no new contributions, is `2026-09-03T10:46:04.042Z`, with projected bytes returning to `4,167,568,368`. This is a reservation-eligibility estimate only. It does not authorize an automatic recovery restart.

These numbers are conservative application accounting and are not exact provider-reported egress usage.

## R5 convergence interpretation

The retained R5 sample used `2,880,972,004` conservative bytes for `5,811` committed ledgers, averaging approximately `495,779` conservative bytes per ledger.

The last retained live lag observation before the halt was `93,539` ledgers. Applying the sample average only as a planning signal gives approximately `43.19 GiB`, or `10.80` times the fixed 4 GiB rolling halt.

This is not a worst-case upper bound and must not be presented as a completion forecast. It establishes that one rolling-window release is not sufficient evidence that the existing recovery shape will converge while the Devnet head continues to advance.

The current resource gate therefore has two separate conclusions:

1. **Safety:** revision 3 passed by halting before mutation.
2. **Convergence:** the current R5 workload shape is not yet proved capable of closing the moving backlog under the unchanged rolling boundary.

## Active replan

The controlling plan is [`ops/r5-egress-convergence-replan-2026-08-06.md`](ops/r5-egress-convergence-replan-2026-08-06.md).

The next evidence order is:

1. reconcile status and resource documents;
2. attribute retained conservative bytes by source and phase without creating recovery mutation;
3. evaluate duplicate-read removal, committed-data reuse, exact payload reduction, explicit verified rebase, and revision-4 necessity;
4. choose revision 3 continuation only with a conservative moving-head convergence proof;
5. otherwise define revision 4 and rerun G1-G10;
6. after explicit selection, run one bounded proof burst before continued recovery.

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
- do not automatically restart when rolling headroom first becomes positive.

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

A selected profile must be revised and requalified when a materially changed accounting or execution contract changes its identity or hard-boundary proof.

R5 recovery may continue under revision 3 only after the active replan proves a conservative end-to-end path that closes backlog faster than new Devnet backlog is created while preserving the unchanged guards and integrity contract.

## Operating restrictions

- Do not treat exact throughput as proof of rolling-window convergence.
- Do not describe conservative application accounting as provider-reported egress.
- Do not reduce the fixed 4 GiB rolling halt or 128 MiB reservation without a source-backed tighter bound and a new decision.
- Do not create production recovery work solely to measure resource use.
- Do not split the same total bytes across more runs and call that a reduction.
- Do not skip ledgers or replace continuity with latest-state-only collection.
- Do not rebase without a fixed validated ledger, complete manifest, relationship, identity, and continuation proof.
- Do not switch the public reader, enable Mainnet, start stabilization, or start soak during R5 replan.
