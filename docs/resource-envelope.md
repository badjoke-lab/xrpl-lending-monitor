# Resource envelope

Last updated: `2026-08-03`.

## Purpose

This document defines the measurable runtime, storage, scheduler, network, query, no-charge, and operator envelope for XRPL Lending Monitor.

The collector core is provider-neutral. Provider limits and unavailable counters are deployment-profile facts, not permanent product architecture.

## Operating principles

- no fixed ledger count is accepted as a complete resource budget;
- every scan is bounded by measured transactions, bytes, requests, CPU, and wall time;
- every commit is bounded by measured storage operations, rows, and bytes;
- finalization is one bounded atomic transaction;
- partial work is invisible and cannot advance a cursor;
- a heavy ledger may span multiple commit phases;
- the scheduler must preserve one-owner serialization and bounded retry;
- the selected profile must have no mandatory paid runtime dependency;
- project guards must halt before provider hard limits or billable overage;
- complete state must remain exportable and restorable;
- a missing provider counter remains missing and may not be replaced by a theoretical projection;
- zero-valued runtime counters are accepted only when zero is independently proved meaningful;
- partial heap or external-memory counters may not substitute for an unavailable total-memory counter;
- profile deployment, rollback, checkpoint, export, restore, evidence, halt, and credential rotation must remain scriptable.

## Reference implementations

SQLite remains the normative local and CI implementation for collector state, chunks, committed-only queries, cursor advancement, deterministic export/restore, interruption, retry, duplicate, lease, and rollback tests.

The durable local scheduler reference proves one-owner serialization, one successor after success, deterministic retry, lease recovery, duplicate convergence, restart persistence, and truthful terminal halt.

Passing the reference implementations proves collector semantics. It does not select a remote production profile.

## Deployment-profile envelope

Each remote profile must publish retained evidence for:

- runtime request, CPU, memory, and wall-time limits;
- external network and WebSocket limits;
- storage transaction, query, row, byte, and size limits;
- scheduler frequency, retention, retry, and operation limits;
- outbound and stored-data transfer limits;
- no-cost included usage and project stop thresholds;
- export, backup, restore, rollback, and credential procedures;
- behavior at each limit, including fail-closed proof;
- routine operation without interactive Dashboard or terminal actions;
- explicit treatment of provider counters unavailable to the verifier.

A provider hard limit is never an operating target. Project thresholds must retain intervention and retry headroom.

## Current-state storage decision

The rejected row-per-object complete live snapshot layout projected approximately:

- 5.03 GB for one complete current snapshot;
- 10.10 GB for active plus rollback plus reserve.

The active architecture remains:

1. one complete verified immutable base read model; plus
2. bounded committed incremental history and current-state overlay in the selected hot store.

Only rows owned by committed work are visible. Every overlay version is bound to network, epoch, base identity, object identity, source ledger/transaction, and owning work.

## Scan, commit, and finalize targets

A scan phase reads from the committed cursor plus one, selects an adaptive contiguous range, caps requests/transactions/bytes/CPU/wall time, verifies parent-hash continuity, derives every semantic class, and advances no public state.

A commit phase loads one staged chunk, caps storage operations/rows/bytes, writes candidate rows by `work_id`, records idempotent completion, and advances no cursor or public watermark.

Reference commit guards:

- at most 40 storage operations per invocation;
- at most 40 canonical row mutations per invocation;
- at most 512,000 encoded bytes per payload chunk;
- at most 16,000 bytes per scheduler message.

Finalization atomically verifies all chunks, ledger/hash identity, network/epoch/base identity, semantic counts, payload digests, current/history ownership, and absence of an earlier unresolved work. Only finalization may commit work and advance public watermarks.

## Throughput result

Required sustained committed throughput:

- steady: greater than 21 ledgers/minute at p95;
- catch-up: greater than 30 ledgers/minute.

Retained R4C2d results:

- steady minute rates: `[24, 24, 24, 24, 24, 24]`;
- steady p95: `24/min`;
- catch-up p95: `14,178.400673920027/min`.

G7 is qualified. This does not qualify G8 or select the profile.

## Current Supabase Free Devnet resource state

The controlling machine-readable state is [`ops/r4c2d-resource-gate-status-2026-08-03.json`](ops/r4c2d-resource-gate-status-2026-08-03.json).

### Measured live values

| Resource | Retained value | Project halt | Hard ceiling or runtime limit | Result |
| --- | ---: | ---: | ---: | --- |
| Database size | 81,939,603 bytes | 400,000,000 | 500,000,000 | below halt |
| Database connections | 10 | 45 | 60 | below halt |
| Edge wall maximum | 5,202.7498 ms | 45,000 | 150,000 | below halt |
| Projected invocations, 31 days | 115,227 | 400,000 | 500,000 | below halt |
| Largest exact deployed bundle | 103,351 bytes | 4,000,000 | 5,000,000 | below halt |
| Maximum CPU statistic | 341 ms | evidence boundary | 2,000 ms | below runtime limit |

The official one-day function statistics covered 14 active functions and 3,717 classified invocations.

### Injected fail-closed behavior

Remote qualification proved exact pre-reservation halts for:

- database size;
- database connections;
- Edge wall time;
- stale or missing external resource snapshot;
- projected function invocations;
- deployed bundle size.

Every injected failure required zero tick, work, message, and successor reservation plus active-source identity preservation.

### Memory boundary

The provider statistics expose average memory but not exact maximum memory.

Six real steady ticks retained 36 deterministic lifecycle samples. RSS remained zero in every sample. Some partial heap or external counters were nonzero, but they do not represent total process memory and cannot be compared with the provider's total Edge memory ceiling.

Consequences:

- exact maximum memory available: `false`;
- positive RSS available: `false`;
- partial heap counters available: `true`;
- partial counters accepted as total memory: `false`;
- memory high-water qualified: `false`;
- memory headroom: unavailable;
- 200 MiB fail-closed headroom proved: `false`.

### Egress boundary

Provider egress bytes are not retained through the PAT-compatible verification path. The unavailable value may not be replaced by request counts, payload size alone, or a Dashboard-only value.

- uncached egress coverage: `false`;
- cached egress coverage: `false`;
- provider egress gate passed: `false`.

An application-level conservative byte bound may be retained as a separate engineering signal but must not be described as provider egress usage.

### Plan and no-charge boundary

PAT-compatible Management API evidence proves exact project identity, exact project-to-organization binding, and organization plan `free`.

Official provider policy establishes that Free-plan over-usage is not charged and quota exhaustion produces notification, grace, and service restriction.

- G1: `pass`;
- G2: `pass`;
- automatic paid overage possible: `false`;
- billing/no-charge qualification: `pass`.

This does not provide provider egress consumption and does not close G8.

## Operator-independence result

Remote run `30789994825` binds profile revision `2` and identity digest `c42edf0a1708fd2b7ea9f2e72dab32b87c1d66b260752efe38fec321253d3998` to:

- scripted repository checkout, Supabase CLI setup, project link, migrations, and exact function deployment set;
- scripted credential generation, masking, rotation, and project scoping;
- scripted checkpoint, export, restore, post-restore continuation, rollback, terminal halt, artifact upload, and Issue publication;
- repeatable restore through first empty-target restore or exact duplicate convergence;
- no routine Dashboard or interactive terminal operation;
- active-profile read-only behavior.

G9 is qualified. G8 remains false and the profile remains unselected.

## Current R4B decision

The controlling revision-2 decision is [`ops/r4c2d-supabase-r4b-decision-2026-08-03.json`](ops/r4c2d-supabase-r4b-decision-2026-08-03.json).

- classification: `conditional_candidate`;
- selection: `not_selected`;
- eligible for scoring: `false`;
- passed gates: `9`;
- failed gates: `0`;
- unresolved gates: `G8`;
- decision digest: `e142f849d59d822da8e5fec5bea8f8dec600950e880b6e597b1971dfcd610b36`.

## Storage and publication rules

- prohibit unbounded full-table API scans;
- query only committed rows bound to active network, epoch, and base identity;
- preserve indexed pagination and deterministic export/restore;
- never advance a cursor after partial persistence;
- never accept state for the wrong source identity;
- publish immutable history from committed work only;
- advance publication watermarks only after independent verification;
- compact hot state only after publication succeeds.

## Remaining measurements before release

R4 still requires:

- usable exact maximum-memory evidence or a formally accepted alternative bound;
- provider egress evidence or a formal unavailable-counter disposition;
- final G8 pass/fail reconciliation;
- an explicit R4E outcome.

After profile selection, later phases still require hot-store growth, index amplification, scheduler operations/retries, API read cost, publication/compaction cost, export/restore duration, downtime catch-up, reconciliation, stabilization, and multi-day operation evidence.

## Automatic guardrails

- stop before execution deadline margins and hard ceilings;
- never advance a cursor or watermark for incomplete work;
- cap ledgers, transactions, retries, bytes, operations, rows, and mutations;
- reject network, epoch, base, parent-hash, digest, or identity mismatch;
- reject zero RSS as unavailable total-memory evidence;
- never substitute partial heap/external counters for RSS;
- keep unavailable provider surfaces visible in the final gate decision;
- preserve scripted rollback, halt, credential rotation, and evidence publication.

## Runtime selection rule

The profile may be selected only after production-shaped evidence demonstrates safety margin for cadence, CPU, memory, network, scheduler operations, storage, query volume, export, restore, reconciliation, catch-up, no-charge operation, and operator independence.

When a hard gate fails or cannot be proved, reject the profile without changing collector semantics. R4E must produce `qualified_profile_selected` or `no_profile_qualified` before R5 begins.
