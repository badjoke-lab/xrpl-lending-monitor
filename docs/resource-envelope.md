# Resource envelope

Last verified: 2026-07-03.

Official references:

- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare D1 pricing and included usage: https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare D1 limits: https://developers.cloudflare.com/d1/platform/limits/

## Purpose

This document defines the measurable runtime, storage, and query envelope for XRPL Lending Monitor.

## Platform limits used for design

### Workers

- request and CPU limits are treated as hard runtime boundaries;
- external subrequests are bounded per invocation;
- memory and wall-time behavior are measured separately from CPU time;
- scheduled collection work must stop before its configured deadline margin.

JSON parsing, normalization, calculations, and serialization consume CPU even when network and storage waits do not.

### D1

- the database-size limit is treated as a hard ceiling;
- a 350 MB projected-use threshold is the stop point before remote current-state bootstrap;
- active current state plus one rollback snapshot must fit inside the threshold together with history and indexes;
- rows read and written are measured per collector run and API route;
- storage growth is measured per day and per protocol event;
- queries are indexed and paginated;
- indexes are included in write-amplification and storage measurements;
- individual rows and statement batches remain bounded below platform limits.

D1 stores network state, cursors, immutable current-state snapshots, manifests, hashes, checkpoints, active pointers, normalized events, lifecycle data, archives, balances, and aggregates.

## Resource targets

Targets remain below platform ceilings and are adjusted only from measured evidence.

### Worker execution

- process bounded ledger batches;
- cap RPC requests and ledgers per run;
- record CPU and wall time;
- avoid global marker traversal, large aggregation, or UI work in the Worker;
- preserve catch-up capacity without skipping ledgers.

### Bootstrap execution

- run one unfiltered binary ledger traversal;
- cap marker pages and decoded objects per resumable unit;
- write bounded D1 batches to an inactive snapshot ID;
- persist the exact marker only after the corresponding batch and typed rows are durable;
- avoid full in-memory accumulation;
- reject changed ledger identity on resume;
- record wall time, heap, requests, pages, decoded objects, relevant objects, normalized bytes, rows written, query count, and retries.

### Database reads

- use indexed pagination;
- prohibit unbounded full-table API scans;
- query only the verified active snapshot for current objects;
- resolve relationships inside the same snapshot;
- precompute overview and daily aggregates where justified;
- measure rows read for every major endpoint.

### Database writes

- write only relevant Lending records;
- write current-state rows only into an inactive snapshot during bootstrap;
- batch related writes within documented statement and row limits;
- account for index write amplification;
- never advance the canonical cursor after partial persistence;
- never replace the active snapshot pointer before complete manifest verification;
- never overwrite completed snapshot rows.

### Storage

- retain normalized canonical history;
- retain the active verified snapshot and one verified rollback snapshot;
- keep incomplete attempts only while explicitly eligible for resume or bounded cleanup evidence;
- make raw transaction retention configurable;
- remove eligible raw payloads only after normalized integrity checks;
- use daily aggregates instead of unnecessarily dense long-term snapshots;
- stop before remote bootstrap when projected total use exceeds 350 MB.

## Checkpoint A measurements

The 2026-07-01 Devnet measurements established:

- 25 unfiltered binary pages decoded 51,200 ledger objects and 3,402 Lending-related objects in 6.858 seconds;
- a complete filtered Vault traversal required 11,481 requests and approximately 835 seconds;
- a complete filtered LoanBroker traversal required 11,481 requests and approximately 855 seconds;
- filtered traversal follows the same global marker chain and does not reduce page count enough to justify repeated scans.

These measurements reject a scheduled Worker full bootstrap and reject three separate filtered traversals.

## Collector runtime selection

### Scheduled Worker

Approved for bounded status refresh and the incremental validated-ledger collector, subject to production-shaped CPU, request, D1, and catch-up measurements.

Acceptance evidence includes:

- p50, p95, and maximum CPU;
- external subrequests per run;
- D1 queries and rows read or written per run;
- catch-up behavior after downtime;
- multi-day Devnet soak results.

### Resumable long-running bootstrap runner

Selected for initial current-state bootstrap and epoch replacement bootstrap.

It must pass:

- exact marker resume tests;
- same-ledger identity enforcement;
- bounded D1 batch generation;
- deterministic object and batch hash tests;
- complete manifest verification;
- incomplete-attempt cleanup tests;
- active-pointer activation and rollback tests;
- same-snapshot relationship tests;
- projected database-size and write-count checks;
- a complete Devnet bootstrap only after local validation and review.

### Reduced-frequency or hybrid reconciliation

Current objects may be reconciled at a lower cadence while transaction collection remains bounded. The interface must display actual freshness and must not claim real-time behavior when collection cadence is lower.

## Measurements required before release

- CPU time per processed ledger at p50, p95, and maximum;
- external subrequests per run;
- D1 queries, rows read, and rows written per run;
- index write amplification;
- database growth per day and per 1,000 protocol events;
- current-state object count, raw bytes, normalized bytes, row count, and projected database bytes;
- active-plus-rollback snapshot storage;
- maximum row size and maximum batch size;
- API rows read for every major endpoint;
- cache hit rate;
- catch-up time after 1 hour and 24 hours of downtime.

## Automatic guardrails

- stop before the execution deadline margin;
- never advance a cursor for an incomplete ledger;
- cap ledgers, transactions, retries, marker pages, statements, and rows per run;
- persist bootstrap continuation only after durable D1 batch completion;
- never activate an incomplete or digest-invalid manifest;
- reject same-snapshot relationship failures;
- stop before remote bootstrap when the projected database use exceeds 350 MB;
- record resource estimates in collector health data;
- show stale-data status when collection slows;
- rate-limit expensive exports;
- preserve canonical normalized data before optional raw payloads.

## Runtime selection rule

The production collector mode is selected only after a production-shaped soak demonstrates adequate safety margin for CPU, requests, storage growth, query volume, and catch-up behavior. When the gate does not pass, choose a documented alternative runtime or cadence and expose the resulting data freshness accurately.
