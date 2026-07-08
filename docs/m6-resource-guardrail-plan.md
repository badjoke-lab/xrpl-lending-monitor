# M6 runtime and resource guardrail baseline plan

Last updated: 2026-07-08.

## Purpose

This document defines the second early M6 hardening unit and the resource-measurement gate required before Explorer v1 implementation begins.

Execution begins only after:

1. M5-5 has exited from retained API and browser evidence;
2. the M6 integrity/reset baseline has established reusable representative scenarios.

The goal is to measure and bound runtime cost across collector, reconciliation, public API, production behavior checks, and the later Explorer v1 presentation layer without weakening integrity guarantees.

## Measurement rule

Do not invent per-route or per-feature numeric budgets before the baseline is measured.

The following existing project gates remain authoritative unless separately changed by evidence and an explicit decision:

- production browser and screenshot probes measure current UTC-day D1 usage before expensive work;
- the existing D1 headroom policy requires rows-read and rows-written fractions below `0.8`;
- public requests remain bounded;
- bootstrap work remains resumable and non-request-driven;
- scheduled collector work remains bounded and catches up across multiple runs;
- no user request may trigger a global bootstrap or full-history aggregation;
- unlike assets remain separate;
- failures, stale state, partial state, and unavailable state remain explicit.

Baseline measurement produces evidence from which additional budgets may be approved. A budget is not accepted merely because a test run happened to finish.

## Measurement dimensions

Where the runtime exposes the measurement, record:

### Worker and collector

- wall time;
- CPU time;
- external subrequests;
- ledgers selected and committed;
- transactions examined;
- supported protocol events processed;
- D1 queries;
- D1 rows read;
- D1 rows written;
- D1 statements;
- overlay upserts;
- tombstones;
- retries;
- deadline-margin stop reason;
- cursor before and after;
- overlay watermark before and after;
- backlog before and after.

### Public API

- route or endpoint identifier;
- request parameters and page limit;
- response status;
- response bytes;
- wall time;
- Worker CPU time where available;
- D1 rows read and written attributable to the bounded operation where measurable;
- immutable base pages or exact lookup assets read;
- D1 overlay rows examined;
- external subrequests;
- cache state only where caching is actually configured and observable;
- provenance/source composition relevant to the response.

### Browser and UI

- page route;
- API requests observed;
- duplicate API request candidates;
- navigation-triggered request changes;
- response failures;
- console and page errors;
- representative interaction request count;
- browser route completion time where measured consistently;
- accessibility and non-JavaScript fallback concerns where applicable.

Browser request count is not a substitute for server-side D1 and base-read measurement.

## Baseline execution order

### M6-R1 — Collector normal-run baseline

Measure healthy near-head incremental operation.

Capture at minimum:

- zero-work or no-new-ledger run behavior;
- one small bounded contiguous batch;
- a batch containing supported Lending activity;
- a batch containing no supported Lending activity.

Exit condition: cost fields are reproducible enough to compare runs, and no normal run performs unbounded work.

### M6-R2 — Replay and catch-up baseline

Reuse scenarios from `m6-integrity-reset-plan.md`.

Measure:

- replay of committed ledger evidence;
- bounded short backlog;
- multi-run larger backlog simulation;
- interruption and exact resume;
- reconciliation after catch-up.

The evidence must distinguish useful work from idempotent no-op or conflict-check work.

Exit condition: catch-up scales through bounded repeated runs and resource evidence shows no hidden full-history or full-table operation.

### M6-R3 — Representative public API read baseline

Measure the approved public read surface in groups.

#### Current-state reads

- Overview;
- Vault list and detail;
- Loan Broker list and detail;
- Loan list and detail;
- exact Search;
- relationship reads used by the UI.

#### Historical and audit reads

- Activity;
- transaction detail;
- Object History;
- per-Loan lifecycle detail;
- Lifecycle explorer;
- Archived Objects list and detail;
- Cover & Loss;
- bounded exports and feeds.

#### System reads

- Network Status;
- collector status;
- other bounded freshness/status endpoints used by the application shell.

For each endpoint, preserve the actual query shape used by representative UI routes. Do not replace expensive real query shapes with simplified benchmark-only queries.

Exit condition: each representative endpoint has a bounded measurement record and no endpoint requires request-time full-history scanning.

### M6-R4 — Production browser request-shape baseline

Use the merged production browser regression evidence shape.

Record:

- discovery logical API requests;
- discovery HTTP attempts;
- browser API requests;
- lifecycle witness selection mode;
- fallback detail-probe count;
- 15-route matrix completion;
- technical findings.

Then inspect browser request traces for:

- duplicate fetches caused by route composition;
- unnecessary repeated status requests;
- list/detail refetches that can be avoided without stale-data risk;
- accidental request fan-out from relationship rendering;
- unbounded polling;
- retries without a cap.

Optimization is accepted only if semantic browser checks and provenance remain unchanged or become stricter.

Exit condition: representative browser behavior is measured and avoidable amplification is either removed or explicitly accepted with evidence.

### M6-R5 — Explorer v1 guardrail harness

This is a harness and measurement contract, not Explorer implementation.

Before E1-2 or later Explorer work can proceed, the harness must be able to record for `/explore`:

- API endpoints used;
- logical API request count;
- HTTP attempt count where retries occur;
- browser API request count;
- D1 rows read attributable to relevant endpoint calls where measurable;
- immutable base page or exact-lookup reads where measurable;
- response bytes;
- representative interaction request deltas;
- cache behavior only where a real cache exists;
- technical browser findings;
- loading, empty, unavailable, stale, partial, and error-state behavior.

Explorer v1 must be evaluated against the existing Monitor APIs and approved bounded composition. The harness must fail or flag when:

- a new collector is introduced;
- a new scheduled job is introduced solely for Explorer v1;
- a user request triggers full-history aggregation;
- an Explorer-only historical analytics pipeline appears before Observatory O1;
- cross-asset totals are introduced without approved pricing semantics;
- a visualization has no accessible textual or structural alternative;
- request count or backend reads cannot be measured at all for the representative path.

Exit condition: the harness is available before Explorer implementation advances beyond contract/composition review.

## Evidence schema

Every measurement run should emit machine-readable JSON and human-readable Markdown.

A measurement record should identify:

```json
{
  "recorded_at": "UTC timestamp",
  "measurement_id": "stable identifier",
  "scenario": "stable scenario identifier",
  "runtime_surface": "collector|api|browser|explorer-harness",
  "network": "devnet-or-local-fixture",
  "epoch_id": "identifier or null",
  "base_snapshot_id": "identifier or null",
  "cursor_before": 0,
  "cursor_after": 0,
  "metrics": {
    "wall_ms": null,
    "cpu_ms": null,
    "external_subrequests": null,
    "d1_queries": null,
    "d1_rows_read": null,
    "d1_rows_written": null,
    "base_pages_read": null,
    "base_exact_lookups": null,
    "response_bytes": null,
    "browser_api_requests": null
  },
  "bounds": {},
  "notes": [],
  "result": {
    "passed": true
  }
}
```

A metric may be `null` when the platform or harness cannot provide it, but the reason must be recorded. Critical resource blind spots must be resolved before a dependent feature is approved.

## Budget approval process

After M6-R1 through M6-R4 produce baseline evidence:

1. group comparable scenarios;
2. distinguish normal, replay, catch-up, reconciliation, and audit costs;
3. identify the highest observed bounded cost for each group;
4. identify variance and retry effects;
5. propose project budgets with explicit safety margin;
6. verify the budget against free-operation objectives and existing D1/headroom controls;
7. record accepted budgets in `resource-envelope.md` and any affected runtime configuration;
8. add fail-closed checks where enforcement is practical.

Do not choose a budget solely to make the current implementation pass.

## Explorer v1 start gate

Explorer v1 may begin only when all are true:

- M5-5 is exited from API and browser evidence;
- the M6 integrity/reset baseline is established;
- M6-R1 collector baseline exists;
- M6-R2 replay/catch-up baseline exists;
- M6-R3 representative API read baseline exists;
- M6-R4 browser request-shape baseline exists;
- the M6-R5 Explorer guardrail harness contract is implementable with the current measurement surfaces;
- no unresolved unbounded read path remains on an API required by Explorer v1;
- source-of-truth documents are reconciled with measured evidence.

## Relationship to Observatory work

These guardrails prepare the Monitor and Explorer v1 release path. They do not authorize Observatory aggregation.

Observatory O1 must separately define metric formulas, event derivation, rollup cadence, retention, reset and replay behavior, API contracts, reconciliation, and resource budgets. O2 and Explorer v2 remain gated behind those stable O1 contracts.
