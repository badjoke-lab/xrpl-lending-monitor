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

## Resource targets

Targets remain below platform ceilings and are adjusted only from measured evidence.

### Worker execution

- process bounded ledger batches;
- cap RPC requests and marker pages per run;
- record CPU and wall time;
- avoid large aggregation or UI work in the collector;
- preserve catch-up capacity without skipping ledgers.

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
- never advance the canonical cursor after partial persistence.

### Storage

- retain normalized canonical history;
- prohibit unchanged snapshots;
- make raw transaction retention configurable;
- remove eligible raw payloads only after normalized integrity checks;
- use daily aggregates instead of unnecessarily dense long-term snapshots.

## Collector runtime options

### Scheduled Worker

Use when production-shaped measurements show adequate CPU, request, and catch-up margin.

Acceptance evidence includes:

- p50, p95, and maximum CPU;
- external subrequests per run;
- D1 queries and rows read or written per run;
- catch-up behavior after downtime;
- multi-day Devnet soak results.

### Scheduled GitHub Actions collector

An alternative runtime when longer execution windows or different scheduling behavior are required. It requires a separate security decision for ingestion credentials and failure isolation.

### Reduced-frequency or hybrid reconciliation

Current objects may be reconciled at a lower cadence while transaction collection remains bounded. The interface must display actual freshness and must not claim real-time behavior when collection cadence is lower.

## Measurements required before release

- CPU time per processed ledger at p50, p95, and maximum;
- external subrequests per run;
- D1 queries, rows read, and rows written per run;
- index write amplification;
- database growth per day and per 1,000 protocol events;
- API rows read for every major endpoint;
- cache hit rate;
- catch-up time after 1 hour and 24 hours of downtime.

## Automatic guardrails

- stop before the execution deadline margin;
- never advance a cursor for an incomplete ledger;
- cap ledgers, transactions, retries, and marker pages per run;
- record resource estimates in collector health data;
- show stale-data status when collection slows;
- rate-limit expensive exports;
- preserve canonical normalized data before optional raw payloads;
- require an explicit deployment decision for material capacity changes.

## Runtime selection rule

The production collector mode is selected only after a production-shaped soak demonstrates adequate safety margin for CPU, requests, storage growth, query volume, and catch-up behavior. When the gate does not pass, choose a documented alternative runtime or cadence and expose the resulting data freshness accurately.
