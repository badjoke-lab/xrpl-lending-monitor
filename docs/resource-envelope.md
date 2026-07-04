# Resource envelope

Last verified: 2026-07-04.

Official references:

- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare D1 pricing and included usage: https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare D1 limits: https://developers.cloudflare.com/d1/platform/limits/

## Purpose

This document defines the measurable runtime, storage, and query envelope for XRPL Lending Monitor.

## Platform boundaries

### Workers

- request and CPU limits are treated as hard runtime boundaries;
- external subrequests are bounded per invocation;
- memory and wall-time behavior are measured separately from CPU time;
- scheduled collection stops before its configured deadline margin;
- the scheduled Worker never performs a complete global bootstrap scan.

### D1

D1 stores bounded incremental and historical state:

- network and epoch state;
- synchronization cursor and ledger continuity state;
- processed-ledger evidence;
- protocol events;
- normalized object changes;
- Loan lifecycle events;
- deleted-object archive records;
- balance history;
- current-state overlay upserts;
- deletion tombstones;
- overlay watermark;
- aggregates, reconciliation state, and collector health.

D1 does not duplicate the complete immutable base read model.

## Current-state storage decision

The earlier row-per-object D1 full-snapshot layout used a 350 MB project stop threshold before remote current-state bootstrap.

A 500-page local Devnet sample decoded 1,024,000 ledger objects and persisted 67,407 Lending objects in the evaluated layout. Local D1 grew by 218,869,760 bytes.

Measured projection was approximately:

- 5.03 GB for one complete row-per-object current snapshot;
- 10.10 GB for active plus rollback plus reserve.

That projection exceeds the project safety envelope. The D1-only complete current-state snapshot layout therefore stops before remote production use.

The active architecture is:

1. one complete verified immutable base read model; plus
2. bounded D1 incremental history and current-state overlay.

This is a technical resource decision. Public documentation does not include unrelated operational circumstances.

## Verified base read model

The base stores complete current Vault, Loan Broker, and Loan state for one fixed validated ledger.

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

## D1 overlay envelope

Overlay storage is limited to changes after the active base ledger.

An overlay upsert records the latest normalized current state for an object changed or created after the base. A deletion tombstone suppresses an object deleted after the base.

Every overlay record is scoped by:

- network;
- epoch;
- base snapshot identity;
- object type;
- object ID;
- source ledger;
- source transaction;
- canonical projection or tombstone state.

Overlay growth is measured by row count, bytes, index amplification, and growth per day.

## Worker execution targets

Scheduled runs:

- process bounded contiguous ledger batches;
- cap RPC requests and ledgers per run;
- cap D1 statements, rows, and overlay mutations per run;
- record CPU and wall time;
- preserve catch-up capacity without skipping ledgers;
- stop on parent-hash discontinuity, base identity mismatch, persistence failure, or deadline margin.

When behind, the collector catches up across multiple runs rather than exceeding runtime limits.

## Bootstrap execution targets

Complete base bootstrap:

- uses one unfiltered binary ledger traversal;
- caps marker pages and decoded objects per resumable unit;
- writes deterministic bounded artifacts and manifests;
- persists the exact marker only after durable artifact output;
- avoids full in-memory accumulation;
- rejects changed ledger identity on resume;
- records requests, pages, decoded objects, relevant objects, bytes, retries, heap, and wall time.

## Database reads

- use indexed pagination;
- prohibit unbounded full-table API scans;
- query only overlay rows bound to the active network, epoch, and base identity;
- resolve current state as overlay upsert > base, tombstone > hidden, otherwise base;
- resolve relationships against the same network, epoch, and base identity;
- precompute overview and daily aggregates where justified;
- measure D1 rows read and base pages read for major endpoints.

## Database writes

- write only Lending-related normalized history and bounded overlay state;
- batch related writes within documented statement and row limits;
- account for index write amplification;
- never advance the canonical cursor after partial persistence;
- never advance the overlay watermark beyond the committed cursor;
- never accept overlay state for the wrong base identity or epoch;
- preserve idempotent replay behavior.

## Checkpoint A measurements

The 2026-07-01 Devnet measurements established:

- 25 unfiltered binary pages decoded 51,200 ledger objects and 3,402 Lending-related objects in 6.858 seconds;
- a complete filtered Vault traversal required 11,481 requests and approximately 835 seconds;
- a complete filtered LoanBroker traversal required 11,481 requests and approximately 855 seconds;
- filtered traversal follows the same global marker chain and does not reduce page count enough to justify repeated scans.

These measurements reject a scheduled Worker full bootstrap and reject three separate filtered traversals.

## Collector runtime selection

### Scheduled Worker

Approved for bounded status refresh and incremental validated-ledger collection, subject to production-shaped evidence for:

- p50, p95, and maximum CPU;
- external subrequests per run;
- D1 queries and rows read or written per run;
- overlay mutations per run;
- catch-up behavior after downtime;
- multi-day Devnet soak results.

### Resumable long-running bootstrap runner

Selected for initial base generation and explicit replacement bootstrap.

It must pass:

- exact marker resume tests;
- same-ledger identity enforcement;
- deterministic artifact generation;
- complete manifest verification;
- relationship tests;
- interruption and resume tests.

### Base read-model publication

Selected for immutable complete current-state base publication.

It must pass:

- verified source manifest identity;
- deterministic record count checks;
- bounded page and lookup generation;
- immutable data publication before active channel change;
- reader integrity checks;
- previous-base preservation on failure.

## Measurements required before release

- CPU time per processed ledger at p50, p95, and maximum;
- external subrequests per run;
- D1 queries, rows read, and rows written per run;
- overlay mutations per run;
- index write amplification;
- database growth per day and per 1,000 protocol events;
- overlay row count and bytes after catch-up;
- tombstone count and bytes after catch-up;
- base page reads and D1 rows read for major endpoints;
- catch-up time after 1 hour and 24 hours of downtime;
- reconciliation cost;
- real multi-day soak evidence.

## Automatic guardrails

- stop before the execution deadline margin;
- never advance a cursor for an incomplete ledger;
- cap ledgers, transactions, retries, marker pages, statements, rows, and overlay mutations per run;
- persist bootstrap continuation only after durable artifact output;
- never publish an incomplete or digest-invalid base;
- reject base identity mismatch;
- never advance the overlay watermark beyond the committed cursor;
- show stale-data status when collection slows;
- rate-limit expensive exports;
- preserve canonical normalized data before optional raw payloads.

## Runtime selection rule

The production collector mode is accepted only after production-shaped evidence demonstrates adequate safety margin for CPU, requests, D1 growth, overlay growth, query volume, reconciliation, and catch-up behavior. When a gate does not pass, choose a documented alternative cadence or bounded runtime path and expose the resulting data freshness accurately.