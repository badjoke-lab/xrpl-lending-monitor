# Resource envelope

Last updated: `2026-08-03`.

## Purpose

This document defines the measurable runtime, storage, scheduler, network, query, and no-charge envelope for XRPL Lending Monitor.

The collector core is provider-neutral. Provider limits and unavailable counters are deployment-profile facts, not permanent product architecture.

## Operating principles

- no fixed ledger count is accepted as a complete resource budget;
- every scan is bounded by measured transactions, bytes, requests, CPU, and wall time;
- every commit is bounded by measured storage operations, rows, and bytes;
- finalization is one bounded atomic transaction;
- partial work is invisible and cannot advance a cursor;
- a heavy ledger may span multiple commit phases;
- the scheduler must preserve one-owner serialization and bounded retry;
- the selected production profile must have no mandatory paid runtime dependency;
- configured project guards must halt before provider hard limits or billable overage;
- complete state must remain exportable into the SQLite reference format;
- a missing provider counter remains missing and may not be replaced by a theoretical projection;
- zero-valued runtime counters are accepted only when the runtime proves that zero is a meaningful measurement.

## Reference implementations

### SQLite storage reference

SQLite remains the normative local and CI implementation for:

- collector work and phase state;
- payload and commit chunks;
- current/history candidate rows;
- committed-only queries;
- cursor and watermark advancement;
- deterministic export and restore;
- interruption, retry, duplicate, lease, and rollback tests.

Passing SQLite tests proves collector semantics. It does not approve a remote production profile.

### Durable local scheduler reference

The local scheduler reference proves:

- exactly one logical owner;
- exactly one successor after success;
- deterministic retry timing;
- lease expiry and recovery;
- duplicate wake-up convergence;
- restart persistence;
- truthful halted state when no successor or owner exists.

It is a conformance reference, not an automatic hosting decision.

## Deployment-profile envelope

Each remote profile must publish retained evidence for:

- runtime request, CPU, memory, and wall-time limits;
- external network and WebSocket limits;
- storage transaction, query, statement, row, byte, and size limits;
- scheduler frequency, retention, retry, and operation limits;
- outbound and stored-data transfer limits;
- no-cost included usage and project stop thresholds;
- export, backup, restore, and rollback procedures;
- behavior at each limit, including proof that it fails closed;
- evidence that routine operation does not require interactive operator actions;
- explicit treatment of provider counters that are unavailable to the deployment verifier.

A provider hard limit is never an operating target. Project thresholds must retain intervention and retry headroom.

## Current-state storage decision

The earlier row-per-object complete live snapshot layout used a 350 MB project stop threshold before remote bootstrap.

A 500-page local Devnet sample decoded 1,024,000 ledger objects and persisted 67,407 Lending objects. Local D1 grew by 218,869,760 bytes.

Measured projection was approximately:

- 5.03 GB for one complete row-per-object current snapshot;
- 10.10 GB for active plus rollback plus reserve.

That layout exceeds the safety envelope and remains rejected.

The active architecture remains:

1. one complete verified immutable base read model; plus
2. bounded committed incremental history and current-state overlay in the selected hot store.

## Verified base read model

The base stores complete current Vault, LoanBroker, and Loan state for one fixed validated ledger.

Requirements:

- one fixed validated ledger index and hash;
- one complete unfiltered marker traversal;
- exact marker resume;
- deterministic normalization;
- deterministic artifact and manifest digests;
- complete count and relationship verification;
- bounded list pages and exact lookup structures;
- immutable publication;
- active-channel update only after verification;
- preservation of the previous verified base when replacement fails.

The base is not rebuilt by every scheduled collector run.

## Hot overlay envelope

Overlay storage is limited to changes after the active base ledger.

Every overlay version is scoped by:

- network;
- epoch;
- base snapshot identity;
- object type;
- object ID;
- source ledger;
- source transaction;
- owning `work_id`;
- projection or tombstone state.

Only rows owned by committed work are visible. Growth is measured by row count, bytes, index amplification, versions per object, and growth per day.

## Scan, commit, and finalize targets

### Scan

A scan phase:

- reads from the committed cursor plus one;
- selects an adaptive contiguous range;
- caps XRPL requests, transactions, decoded bytes, normalized bytes, payload bytes, CPU, and wall time;
- validates parent-hash continuity;
- derives every semantic class;
- writes only bounded staging records and payload chunks;
- advances no public cursor or watermark.

The initial 48-ledger scan ceiling remains a test value, not a production safety claim.

### Commit

A commit phase:

- loads one staged chunk;
- caps storage operations, rows, and bytes;
- writes candidate rows tagged by `work_id`;
- records chunk completion idempotently;
- advances no cursor or public watermark;
- schedules another commit or finalization.

Reference guards:

- at most 40 storage operations per invocation;
- at most 40 canonical row mutations per invocation;
- at most 512,000 encoded bytes per staged payload chunk;
- at most 16,000 bytes per scheduler message.

### Finalize

Finalization must atomically verify:

- all chunks complete;
- exact start/end ledger and parent/final hashes;
- unchanged network, epoch, and base identity;
- matching semantic counts and payload digests;
- consistent current/history ownership;
- no earlier unresolved work blocking the cursor.

Only finalization may mark work committed and advance public watermarks.

## Throughput targets and result

Required sustained committed throughput:

- steady: greater than 21 ledgers/minute at p95 windows;
- catch-up: greater than 30 ledgers/minute.

These targets include scan, all commit phases, and finalization.

R4C2d retained:

- steady minute rates `[24, 24, 24, 24, 24, 24]`;
- steady p95 `24/min`;
- catch-up p95 `14,178.400673920027/min`.

G7 is qualified for the measured Supabase qualification design. This does not qualify G8 or select the profile.

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
| Maximum CPU statistic | 341 ms | evidence boundary | 2,000 ms runtime limit | below runtime limit |

The official one-day function statistics covered 14 active functions and 3,717 classified invocations.

### Injected fail-closed behavior

The remote qualification proved exact pre-reservation halts for:

- database size;
- database connections;
- Edge wall time;
- stale or missing external resource snapshot;
- projected function invocations;
- deployed bundle size.

Every injected failure required zero tick, work, message, and successor reservation, plus active source identity preservation.

### Memory boundary

The provider statistics expose average memory but not exact maximum memory.

Six real steady ticks retained 36 deterministic `Deno.memoryUsage()` lifecycle samples. Every RSS, heap-total, heap-used, and external-memory counter was zero.

That result is classified as **counter unavailable**, not zero consumption.

Consequences:

- exact maximum memory available: `false`;
- memory high-water qualified: `false`;
- memory headroom: unavailable;
- 200 MiB fail-closed headroom proved: `false`;
- average-memory statistics may not be substituted for exact maximum-memory evidence.

### Egress boundary

Provider egress bytes are not retained through the PAT-compatible verification path. The unavailable value may not be replaced by request counts, payload size alone, or a Dashboard-only value.

Consequences:

- uncached egress coverage: `false`;
- cached egress coverage: `false`;
- provider egress gate passed: `false`.

An application-level conservative byte bound may be retained as a separate engineering signal, but it must not be described as provider egress usage.

### Plan, billing, and automatic overage

The PAT-compatible Management API proves:

- exact project identity;
- exact project-to-organization binding;
- organization plan `free`.

It does not expose the Studio usage-billing flag or automatic-overage state to the verifier.

Consequences:

- Free plan identity: measured;
- Free no-charge policy applicability: recorded;
- usage-billing flag coverage: `false`;
- automatic-overage API coverage: `false`;
- billing and overage qualification: `false`.

Free-plan identity is not a replacement for missing billing-state evidence.

## Storage and database reads

- use indexed pagination;
- prohibit unbounded full-table API scans;
- query only committed rows bound to the active network, epoch, and base identity;
- resolve current state as newest committed overlay upsert > base, newest committed tombstone > hidden, otherwise base;
- resolve relationships against the same network, epoch, and base identity;
- precompute overview and daily aggregates where justified;
- measure rows, bytes, operations, and latency for major endpoints;
- preserve deterministic full export and restore.

## Storage and database writes

- write only Lending-related normalized history and bounded overlay state;
- batch related writes within adapter limits;
- account for index write amplification;
- never advance the canonical cursor after partial persistence;
- never advance a watermark beyond the committed cursor;
- never accept overlay state for the wrong base identity or epoch;
- preserve idempotent replay behavior;
- isolate maintenance and compaction from scan and commit phases.

## Immutable publication

Long-lived semantic history remains outside the hot operational store in deterministic immutable segments and exact indexes.

Publication:

- reads committed work only;
- verifies ledger/hash and semantic-count continuity;
- publishes immutable artifacts;
- independently verifies them;
- advances the publication watermark only after verification;
- authorizes bounded hot-store compaction only after publication succeeds.

Publication automation is not the normal collection scheduler.

## Production-shaped probes

Browser regression, screenshot audit, and other expensive read-only probes must preserve the same resource discipline as runtime work.

- measure active-profile headroom before dependency installation or traversal;
- require the documented headroom gate to pass;
- cap fallback witness detail probes;
- record logical API requests, HTTP attempts, and bounded witness-selection mode;
- retain separate human screenshot review where required.

A failed headroom gate is successful guardrail behavior. No browser or visual-audit result may be claimed when the workflow stops before traversal.

## Remaining measurements before release

- usable exact maximum-memory evidence or a formally accepted alternative bound;
- provider egress evidence or a formal unavailable-counter disposition;
- usage-billing and automatic-overage evidence or a formal hard-gate failure;
- hot-store growth per day and per 1,000 protocol events;
- index write amplification;
- scheduler operations and retries per day;
- current/history API read cost;
- publication and compaction cost;
- complete export and restore duration under the candidate profile;
- catch-up after one hour and 24 hours of downtime;
- reconciliation cost;
- real multi-day operation evidence after profile selection.

## Automatic guardrails

- stop before execution deadline margins;
- never advance a cursor for incomplete work;
- cap ledgers, transactions, retries, bytes, storage operations, rows, and overlay mutations;
- never publish an incomplete or digest-invalid base;
- reject network, epoch, base, or parent-hash mismatch;
- never advance a watermark beyond the committed cursor;
- show stale or halted status when collection slows or loses its successor;
- rate-limit expensive exports;
- preserve canonical normalized data before optional raw payloads;
- stop browser and screenshot probes before traversal when measured headroom does not pass;
- stop before any configured paid overage or provider hard limit;
- reject all-zero resource counters as unavailable unless zero is independently meaningful;
- keep unavailable provider surfaces visible in the final gate decision.

## Runtime selection rule

The production profile is selected only after production-shaped evidence demonstrates adequate safety margin for cadence, CPU, memory, network, scheduler operations, storage growth, query volume, export, restore, reconciliation, catch-up behavior, and no-charge operation.

When a profile fails or cannot satisfy a hard gate, reject it without changing collector semantics. R4E must produce a qualified selected profile or `no_profile_qualified` before R5 begins.
