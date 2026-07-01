# Resource envelope

Last verified: 2026-07-01.

Official references:

- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare D1 pricing and included usage: https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare D1 limits: https://developers.cloudflare.com/d1/platform/limits/

## Purpose

This document defines the measurable runtime, storage, and query envelope for XRPL Lending Monitor. It is an engineering specification for reliability and bounded operation, not a statement about private budgets or organizational constraints.

## Platform limits used for design

### Workers

- request and CPU limits are treated as hard runtime boundaries;
- external subrequests are bounded per invocation;
- memory and wall-time behavior are measured separately from CPU time;
- scheduled collection work must stop before its configured deadline margin.

JSON parsing, normalization, calculations, and serialization consume CPU even when network and storage waits do not.

### D1

- rows read and written are measured per collector run and API route;
- storage growth is measured per day and per protocol event;
- queries are indexed and paginated;
- indexes are included in write-amplification measurements;
- database and per-query limits are treated as explicit design constraints.

D1 stores network state, cursors, snapshot metadata, manifests, active pointers, normalized events, lifecycle data, archives, and aggregates. Full bootstrap object rows are not bulk-loaded into D1.

### External bootstrap storage

- object data is split into bounded compressed shards;
- every shard has a stable sequence, object type, byte size, object count, and content hash;
- a manifest references only complete uploaded shards;
- incomplete attempts are not visible through the active pointer;
- upload, retry, cleanup, and retained-attempt costs are measured.

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
- cap marker pages and decoded objects per resumable batch;
- persist the exact marker after durable shard completion;
- avoid full in-memory accumulation;
- reject changed ledger identity on resume;
- record wall time, heap, requests, pages, decoded objects, relevant objects, shard bytes, and retries.

### Database reads

- use indexed pagination;
- prohibit unbounded full-table API scans;
- precompute overview and daily aggregates where justified;
- measure rows read for every major endpoint.

### Database writes

- write only relevant Lending events;
- write state snapshots only on change;
- batch related writes;
- account for index write amplification;
- never advance the canonical cursor after partial persistence;
- never replace the active snapshot pointer before complete manifest verification.

### Storage

- retain normalized canonical history;
- prohibit unchanged snapshots;
- make raw transaction retention configurable;
- remove eligible raw payloads only after normalized integrity checks;
- use daily aggregates instead of unnecessarily dense long-term snapshots;
- retain only the active bootstrap snapshot plus explicitly required rollback or failed-attempt evidence.

## Checkpoint A measurements

The 2026-07-01 Devnet measurements established:

- 25 unfiltered binary pages decoded 51,200 ledger objects and 3,402 Lending-related objects in 6.858 seconds;
- a complete filtered Vault traversal required 11,481 requests and approximately 835 seconds;
- a complete filtered LoanBroker traversal required 11,481 requests and approximately 855 seconds;
- filtered traversal follows the same global marker chain and does not reduce page count enough to justify repeated scans.

These measurements reject a scheduled Worker full bootstrap and reject three separate filtered traversals.

## Collector runtime selection

### Scheduled Worker

Approved for bounded status refresh and the future incremental validated-ledger collector, subject to production-shaped CPU, request, D1, and catch-up measurements.

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
- bounded shard generation;
- upload retry and idempotency tests;
- complete manifest verification;
- incomplete-attempt cleanup tests;
- active-pointer rollback tests;
- preview full-bootstrap execution.

### Reduced-frequency or hybrid reconciliation

Current objects may be reconciled at a lower cadence while transaction collection remains bounded. The interface must display actual freshness and must not claim real-time behavior when collection cadence is lower.

## Measurements required before release

- CPU time per processed ledger at p50, p95, and maximum;
- external subrequests per run;
- D1 queries, rows read, and rows written per run;
- index write amplification;
- database growth per day and per 1,000 protocol events;
- bootstrap shard count, compressed bytes, upload duration, and retry count;
- API rows read for every major endpoint;
- cache hit rate;
- catch-up time after 1 hour and 24 hours of downtime.

## Automatic guardrails

- stop before the execution deadline margin;
- never advance a cursor for an incomplete ledger;
- cap ledgers, transactions, retries, and marker pages per run;
- persist bootstrap continuation only after durable shard completion;
- never activate an incomplete manifest;
- record resource estimates in collector health data;
- show stale-data status when collection slows;
- rate-limit expensive exports;
- preserve canonical normalized data before optional raw payloads;
- require an explicit deployment decision for material capacity changes.

## Runtime selection rule

The production collector mode is selected only after a production-shaped soak demonstrates adequate safety margin for CPU, requests, storage growth, query volume, and catch-up behavior. When the gate does not pass, choose a documented alternative runtime or cadence and expose the resulting data freshness accurately.
