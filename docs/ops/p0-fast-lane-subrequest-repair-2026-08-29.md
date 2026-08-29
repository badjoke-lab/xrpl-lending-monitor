# P0 fast-lane subrequest repair — 2026-08-29

## Disposition

The direct production Current-state blocker is the Cloudflare/D1 fast lane, not the Supabase History recovery path.

A fresh read-only production probe (`Read-only production qualification` run `33247087956`) observed:

- fast-lane last processed ledger: `4,051,454`;
- fast-lane last update: `2026-08-01T03:52:12.771Z`;
- last observed ledger retained by the stopped lane: `4,108,194`;
- retained lag at stop: `56,740` ledgers;
- latest run error: `Too many subrequests by single Worker invocation.`;
- failing run timestamp: `2026-08-01T03:53:44.349Z`;
- canonical overlay watermark: `4,039,122`;
- active immutable base ledger: `4,039,102`;
- production mutation performed by the probe: none.

The public API remained HTTP-available but its Current data was stale.

## Failure in the previous correction

PR `#1069` reduced `FAST_LANE_MAX_LEDGERS_PER_RUN` to 32 and called that value subrequest-safe. That was not a complete proof.

The path still allowed:

1. a failed WebSocket ledger read to fan out over every configured HTTP fallback endpoint for each subsequent ledger;
2. one D1 persistence query per current-object mutation;
3. one D1 history insert and one activity insert per bounded history window;
4. up to six complete fast-lane cycle retries inside the same Worker invocation after a transient XRPL failure;
5. the surrounding Queue claim, retention, capacity, metric, successor, and promotion queries in the same invocation.

Cloudflare Workers Free currently permits 50 external subrequests per invocation, and D1 Free permits 50 queries per Worker invocation. Therefore a ledger-count cap by itself is not a valid subrequest envelope.

## Repair contract

PR `#1490` changes the application envelope rather than increasing platform limits.

### External XRPL fallback

- WebSocket remains primary.
- Emergency HTTP fallback is capped at 4 requests per cycle.
- Budget exhaustion throws `FastLaneHttpFallbackBudgetError` before another fallback request is made.
- A full fast-lane cycle is attempted only once per Worker invocation by default.
- Transient cycle failures are handed back to the Queue and retried in a later Worker invocation, which starts with fresh platform subrequest/query budgets.
- The application-level budget error remains retryable; the platform-level `Too many subrequests` error must no longer be the normal control mechanism.

### D1 persistence

- current projection mutations are grouped, up to 256 mutations per D1 query;
- bounded history windows are grouped, up to 8 windows per D1 query;
- activity-window rows are grouped on the same 8-window boundary;
- the persistence batch has an explicit maximum of 24 D1 queries;
- if the calculated persistence batch would exceed 24 queries, `FastLaneD1QueryBudgetError` is raised before `db.batch()`.

The remaining D1 query headroom is reserved for queue-slot state, storage checks, run metrics, retention, cursor verification, successor staging/completion, and caught-up promotion.

## Safety boundary

This repair does not itself:

- deploy a Worker;
- restart or reseed the Queue;
- add a cron trigger;
- mutate production D1;
- alter the public reader;
- mutate Supabase;
- rearm R5 History recovery;
- enable Mainnet;
- authorize stabilization or soak.

A separate read-only preflight and explicit production operational authorization remain required before Current collection is restarted.
