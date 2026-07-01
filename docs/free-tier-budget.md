# Free-tier operating budget

Last verified: 2026-07-01.

Official sources:

- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare D1 limits: https://developers.cloudflare.com/d1/platform/limits/

## Current platform limits used for planning

### Workers Free

- 100,000 requests per day
- 10 ms CPU time per HTTP request
- 10 ms CPU time per Cron Trigger
- 50 external subrequests per invocation
- 5 Cron Triggers per account
- 128 MB memory
- 15-minute Cron wall-time ceiling, while CPU remains separately limited

Network and storage waiting time is not CPU time, but JSON parsing, normalization, calculations, and serialization consume CPU.

### D1 Free

- 5,000,000 rows read per day
- 100,000 rows written per day
- 5 GB total storage per account
- 500 MB maximum per database
- 50 D1 queries per Worker invocation
- indexes add write rows when indexed values change

Free limits are account-level where Cloudflare specifies them as such, so this project must account for other badjoke-lab workloads sharing the same plan.

## Important conclusion

The read-only website and API can operate on the free tier at the expected initial scale.

The collector is **not assumed free by declaration**. The 10 ms Free Worker CPU limit is tight for multi-ledger JSON parsing and normalization. The collector architecture must be benchmarked before production cadence is approved.

## Budget targets

Internal targets are deliberately below platform limits.

### Worker requests

- target under 20,000 requests/day for this project;
- cached list and overview API responses;
- static assets do not require dynamic API work;
- abusive query patterns are bounded.

### D1 rows read

- warning at 2,500,000/day;
- critical at 4,000,000/day;
- indexed pagination only;
- no unbounded full-table API scans;
- precomputed overview and daily aggregates.

### D1 rows written

- warning at 50,000/day;
- critical at 80,000/day;
- write only relevant Lending events;
- write state snapshots only on change;
- batch related writes;
- account for index write amplification.

### Storage

- warning at 300 MB for the project database;
- critical at 425 MB;
- normalized history is retained;
- unchanged snapshots are forbidden;
- raw transaction JSON has a configurable retention period;
- old raw payloads may be removed after normalized integrity checks;
- daily aggregates replace unnecessarily dense long-term snapshots.

## Collector execution options

### Option A — Cloudflare Cron Worker

Preferred only if measured CPU remains safely below the Free limit.

Design constraints:

- process very small bounded ledger batches;
- minimize object allocation and repeated JSON transformations;
- batch D1 statements;
- perform no UI rendering or large aggregation in the collector;
- record actual CPU and wall time;
- reduce cadence automatically when behind or near limits.

Acceptance gate:

- p95 measured CPU below 7 ms during a multi-day Devnet soak;
- no invocation exceeds 10 ms in the acceptance run;
- catch-up remains possible without skipping ledgers.

### Option B — Scheduled GitHub Actions collector

Fallback when Worker CPU is not viable.

- public repository scheduled workflow;
- TypeScript collector runs in Actions;
- Cloudflare credentials stored as GitHub secrets;
- writes through a narrowly scoped ingestion path or approved D1 API mechanism;
- expected cadence is lower and scheduling is not exact;
- the API still runs on Cloudflare Free.

This option requires a separate security decision because it introduces ingestion credentials and a different operational failure mode.

### Option C — reduced-frequency reconciliation

For the Devnet preview, current objects may be scanned less frequently while transaction collection remains bounded. The interface must show actual freshness and never claim real-time behavior when cadence is reduced.

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

- stop before CPU deadline margin;
- never advance cursor for an incomplete ledger;
- maximum ledgers and transactions per run;
- maximum marker pages per scan with explicit failure;
- write and storage usage estimates recorded in health data;
- stale-data banner when collection slows;
- rate-limit expensive exports;
- disable raw payload retention before canonical normalized data;
- never silently switch to a paid plan.

## Free-operation decision rule

The project may be described as fully free to operate only after the production-shaped soak test demonstrates that the chosen collector mode, API traffic, D1 usage, storage growth, CI, and domain arrangement remain within free allowances with safety margin.

If that gate fails, reduce cadence or use the approved free fallback. Do not incur paid Cloudflare usage without explicit approval.
