# Resource envelope

Last updated: 2026-08-01.

## Purpose

This document defines the measurable runtime, storage, scheduler, network, and query envelope for XRPL Lending Monitor.

The collector core is provider-neutral. Provider limits are recorded in deployment-profile documents and tests, not treated as permanent product architecture.

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
- complete state must remain exportable into the SQLite reference format.

## Reference implementations

### SQLite storage reference

SQLite is the normative local and CI implementation for:

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

Each remote profile must publish a retained profile specification containing:

- runtime request, CPU, memory, and wall-time limits;
- external network and WebSocket limits;
- storage transaction, query, statement, row, byte, and size limits;
- scheduler frequency, retention, retry, and operation limits;
- outbound and stored-data transfer limits;
- no-cost included usage and project stop thresholds;
- export, backup, restore, and rollback procedures;
- behavior at each limit, including proof that it fails closed;
- evidence that routine operation does not require interactive operator actions.

A provider hard limit is never an operating target. Project thresholds must retain intervention and retry headroom.

## Current-state storage decision

The earlier row-per-object complete live snapshot layout used a 350 MB project stop threshold before remote current-state bootstrap.

A 500-page local Devnet sample decoded 1,024,000 ledger objects and persisted 67,407 Lending objects in the evaluated layout. Local D1 grew by 218,869,760 bytes.

Measured projection was approximately:

- 5.03 GB for one complete row-per-object current snapshot;
- 10.10 GB for active plus rollback plus reserve.

That projection exceeds the project safety envelope for the tested profile. The complete row-per-object hot-store layout therefore remains rejected.

The active product architecture remains:

1. one complete verified immutable base read model; plus
2. bounded committed incremental history and current-state overlay in the selected hot store.

This is a technical resource decision.

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
- active channel update only after verification;
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

Only rows owned by committed work are visible. Overlay growth is measured by row count, bytes, index amplification, versions per object, and growth per day.

## Scan execution targets

A scan phase:

- reads from the committed cursor plus one;
- selects an adaptive contiguous range;
- caps XRPL requests, transactions, decoded bytes, normalized bytes, payload bytes, CPU, and wall time;
- validates parent-hash continuity;
- derives every semantic class;
- writes only bounded staging records and payload chunks;
- advances no public cursor or watermark.

Initial scan ceiling: 48 ledgers for tests only. It may shrink to one heavy ledger. It is not a production safety claim.

## Commit execution targets

A commit phase:

- loads one staged chunk;
- caps storage operations, rows, and bytes;
- writes candidate rows tagged by `work_id`;
- records chunk completion idempotently;
- advances no cursor or public watermark;
- schedules another commit or finalization.

Initial reference guards:

- at most 40 storage operations per invocation;
- at most 40 canonical row mutations per invocation;
- at most 512,000 encoded bytes per staged payload chunk;
- at most 16,000 bytes per scheduler message.

Remote adapters may use stricter values. Any increase requires retained production-shaped evidence.

## Finalize execution targets

Finalization must atomically verify:

- all chunks complete;
- exact start/end ledger and parent/final hashes;
- unchanged network, epoch, and base identity;
- matching semantic counts and payload digests;
- consistent current/history ownership;
- no earlier unresolved work blocking the cursor.

Only finalization may mark work committed and advance public watermarks.

## Throughput targets

Observed Devnet advance was approximately 84 ledgers per five minutes, or 16.8 ledgers/minute.

Required sustained committed throughput:

- steady: greater than 21 ledgers/minute at p95 windows;
- catch-up: greater than 30 ledgers/minute.

These targets include scan, all required commit phases, and finalization. A fast scan with slow persistence does not pass.

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

## Production-shaped browser and audit probes

Production browser regression, screenshot audit, and other expensive read-only probes must preserve the same resource discipline as public runtime work.

- measure active-profile read/write headroom before dependency installation or traversal;
- require the documented headroom gate to pass;
- prefer reuse of bounded result windows and in-memory set intersection;
- cap fallback witness detail probes;
- reuse representative entities where coverage is preserved;
- do not remove relationship, history, archive, Search, freshness, error, or provenance checks merely to reduce reads;
- record logical API requests, HTTP attempts, and bounded witness-selection mode;
- retain separate human screenshot review where required.

A failed headroom gate is successful guardrail behavior. No browser or visual-audit result may be claimed when the workflow stops before traversal.

## Checkpoint A measurements

The 2026-07-01 Devnet measurements established:

- 25 unfiltered binary pages decoded 51,200 ledger objects and 3,402 Lending-related objects in 6.858 seconds;
- a complete filtered Vault traversal required 11,481 requests and approximately 835 seconds;
- a complete filtered LoanBroker traversal required 11,481 requests and approximately 855 seconds;
- filtered traversal follows the same global marker chain and does not reduce page count enough to justify repeated scans.

These measurements reject a scheduled full bootstrap and reject three separate filtered traversals.

## Runtime selection

### Portable incremental collector

Approved for implementation and local/CI validation.

It must pass:

- adaptive budget tests;
- heavy-ledger split tests;
- work lifecycle and committed-only visibility tests;
- interruption, retry, duplicate, lease, and restart tests;
- full export and restore tests;
- storage and scheduler adapter conformance tests.

### Candidate remote profile

Not approved until R4.

It must pass:

- XRPL WebSocket compatibility;
- p50, p95, and maximum CPU/wall time;
- external requests per phase;
- storage operations, rows, and bytes per phase and per day;
- scheduler operation and retry volume;
- hot-store growth and compaction;
- one-hour and 24-hour downtime catch-up;
- no-cost envelope and fail-closed stop thresholds;
- export, backup, restore, and rollback;
- multi-day Devnet qualification.

### Resumable bootstrap runner

Selected for initial base generation and explicit replacement bootstrap.

It must pass exact marker resume, same-ledger identity, deterministic artifact, manifest, relationship, interruption, and resume tests.

## Measurements required before release

- CPU and wall time per phase at p50, p95, and maximum;
- external requests per scan;
- storage operations, rows read, rows written, and bytes per phase;
- index write amplification;
- scheduler operations and retries per day;
- hot-store growth per day and per 1,000 protocol events;
- overlay versions and tombstones after catch-up;
- current/history API read cost;
- publication and compaction cost;
- complete export and restore duration;
- catch-up time after 1 hour and 24 hours of downtime;
- reconciliation cost;
- real multi-day operation evidence.

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
- stop before any configured paid overage or provider hard limit.

## Runtime selection rule

The production profile is selected only after production-shaped evidence demonstrates adequate safety margin for cadence, CPU, network requests, scheduler operations, storage growth, query volume, export, restore, reconciliation, and catch-up behavior.

When a profile fails a gate, reject that profile without changing collector semantics. Choose another documented profile or expose the resulting data freshness accurately.
