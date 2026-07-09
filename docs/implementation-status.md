# Implementation status

Last updated: 2026-07-09.

## Current phase

The canonical-history and replacement-base cutover is complete on XRPL Devnet. Production history runs in verified hybrid mode: immutable canonical history covers ledgers `3371676..3432924`, and D1 live continuation covers the boundary after ledger `3432924`. The active current-state base is `devnet-3432924-canonical` at ledger `3432924`.

M1 exit is complete. M5-5 real-data integration remains active. M6 remains gated behind M5-5 browser evidence and has not started.

The retained M5-5 API-level production cross-audit evidence from `2026-07-08 00:52:38 UTC` remains passing. The remaining M5-5 exit requirement is production-shaped browser evidence plus the fail-closed browser exit evaluator.

## Active recovery — five-minute scheduled collector tuning

Cloudflare production Observability on `2026-07-09` showed repeated scheduled collector events with `cron=* * * * *` and `outcome=exceededCpu`. The first GitHub catch-up runtime monitor rerun after the UTC-day reset showed D1 usage had recovered, but collector cursor still did not advance.

PR #296 changed the production Worker schedule from every minute to five-minute cadence and reduced per-run incremental collector budgets for Cloudflare Worker Free operation. The retained post-merge runtime monitor artifact created at `2026-07-09T05:11:52Z` passed all lightweight runtime invariants:

- samples: `3`;
- cursor: `3497296 -> 3497376`;
- `cursor_delta`: `80`;
- `samples_with_failures`: `0`;
- consecutive failures: `0`;
- error: `null`;
- D1 rows read: `1,145,867 / 5,000,000`;
- D1 rows written: `3,518 / 100,000`.

This proved the collector was no longer fully stuck under the first free-tier recovery profile, but it did not prove the collector was caught up. The same artifact recorded `head_delta=198` and `lag_delta=118`.

PR #297 raised the five-minute profile to 16 ledgers/run. The retained runtime monitor artifact created at `2026-07-09T07:05:22Z` passed, but still showed `cursor_delta=32`, `head_delta=177`, and `lag_delta=+145`, with D1 rows read at `2,309,361 / 5,000,000`.

PR #298 raised the five-minute profile to 32 ledgers/run. The retained runtime monitor artifact created at `2026-07-09T08:08:50Z` passed, but still showed `cursor_delta=64`, `head_delta=175`, and `lag_delta=+111`, with D1 rows read at `3,479,262 / 5,000,000`.

Therefore 32 ledgers/run is still below observed Devnet head growth, and same-day D1 usage is too high for further safe probing. The next prepared unit is a 64-ledger/run free-tier limit test after UTC daily D1 reset. This is a measurement unit, not a final health claim.

## Latest retained runtime evidence

### HYB-7 and M1

The retained M1 exit evidence at `2026-07-08 00:13:44 UTC` recorded collector healthy, cursor/head `3476415`, lag `0`, zero consecutive failures, HYB-7 `passed: true`, M1 diagnostics `ready: true`, and bounded replacement-base, hybrid-history, Overview, and current list/detail exact-read checks passing.

### M5-5 production cross-audit

At `2026-07-08 00:52:38 UTC`, the D1-gated production cross-audit passed with collector healthy, cursor/head `3477191`, lag `0`, active snapshot `devnet-3432924-canonical`, sampled Vault/Broker/Loan relationships, lifecycle/current/history checks, archive exclusion, Activity classification, Cover & Loss availability, exports/feed, and D1 headroom passing.

### Browser prerequisite and resource gate

The durable production browser-regression path is merged and validated in CI. It discovers bounded live witnesses, traverses 15 representative routes, performs relationship/history/archive/Search/freshness behavior checks, records request-count evidence, retains `runner.log`, and fails on rendered state errors, console errors, page errors, HTTP 5xx findings, or missing required behavior.

The browser exit evaluator is merged and writes `exit-evaluation.json` and `exit-evaluation.md`. A passing evaluator marks browser evidence ready for M5-5 exit reconciliation, but retained API cross-audit evidence remains a separate prerequisite.

No M5-5 browser pass is claimed while the production collector remains materially behind.

## Explorer v1 pre-entry design preparation

Documentation-only Explorer v1 pre-entry design preparation is complete and formalized. This preparation does not start E1-1 and does not change runtime behavior, public routes, API contracts, collector behavior, D1 persistence, schedules, deployment, or resource thresholds.

Prepared Explorer documents:

- `docs/explorer-v1-visual-direction.md`;
- `docs/explorer-v1-contract-matrix.md`;
- `docs/explorer-v1-translation-dictionary.md`;
- `docs/explorer-v1-content-copy.md`;
- `docs/explorer-v1-relationship-contract.md`;
- `docs/explorer-v1-static-api-shape-audit.md`.

Explorer v1 remains gated behind M5-5 exit plus the required M6 integrity/reset and runtime/resource baselines.

## Approved Explorer and Observatory sequence

The approved order is:

```text
M5-5 completion
  -> M6 integrity/reset baseline
  -> M6 runtime/resource guardrail baseline
  -> Explorer v1
  -> remaining M6 visual/release hardening
  -> public Devnet release and real soak
  -> O1 XRPL Lending Observatory data foundation
  -> O2 Observatory monitoring view
  -> O3 Explorer v2
```

Explorer v1 is a bounded presentation layer over approved contracts. It must not add a separate collector, scheduled job, request-time full-history scan, or Explorer-specific historical analytics pipeline.

## Active unit

The active implementation unit is preparing a 64-ledger/run five-minute free-tier collector limit test for after UTC daily D1 reset.

1. Preserve five-minute cadence.
2. Stage the 64-ledger/run profile in draft.
3. Do not merge or run the monitor again before UTC daily D1 reset unless production safety requires rollback.
4. After UTC reset and a short counter-settlement buffer, merge/deploy the 64 profile.
5. Wait for Cloudflare deployment and at least two scheduled cron windows.
6. Run the catch-up runtime monitor once.
7. Accept the test only if cursor advances without failures, D1 headroom remains safe, and lag growth is reduced or reversed.

Track A — M5-5 browser evidence — remains blocked until collector tuning evidence is captured. Track B — production UI audit — also remains gated by measured current-day headroom and collector health.

Neither track may weaken collector integrity, D1 resource gates, or browser exit criteria.

## Prepared post-M5-5 units

Preparation is complete for the first two M6 hardening areas, but execution has not started.

- `docs/m6-integrity-reset-plan.md` defines the first executable M6 integrity/reset baseline after M5-5 exit.
- `docs/m6-i1-fixture-catalog.md` prepares deterministic M6-I1 F00-F14 scenarios, shared context/object/asset families, evidence snapshot requirements, and M6-I2-I5 reuse.
- `docs/m6-resource-guardrail-plan.md` defines the early M6 runtime/resource measurement order, evidence contract, budget-approval process, and Explorer v1 resource-harness gate.

M6-I1 may begin only after M5-5 exits and after issue #283, the fixture catalog, and existing helper inventory are reviewed.

## Next order

1. Keep the 64-ledger/run draft PR staged until UTC daily D1 reset.
2. After UTC reset plus a short buffer, merge/deploy the 64-ledger/run test profile.
3. Confirm collector cursor advancement, zero failures, D1 headroom, and lag behavior with one retained catch-up runtime monitor artifact.
4. If 64 still underperforms, decide whether to test 96 after a later reset or record that Cloudflare Worker Free cannot provide catch-up-grade near-real-time operation.
5. Run or rerun M5-5 browser regression only after collector preflight and D1 headroom gates pass.
6. Inspect `summary.json`, `summary.md`, `runner.log`, `exit-evaluation.json`, `exit-evaluation.md`, collector preflight, and D1 headroom evidence.
7. Reconcile M5-5 exit only when retained API and browser evidence both satisfy their gates.
8. After M5-5 exits, begin M6-I1 using `docs/m6-integrity-reset-plan.md`, `docs/m6-i1-fixture-catalog.md`, and issue #283 after inventorying existing helpers.

## Remaining blockers

- Production scheduled collector is advancing without failures, but retained evidence still shows growing lag at the 32-ledger/run five-minute profile.
- Same-day D1 read usage is too high for additional safe probing before UTC daily reset.
- M5-5 API cross-audit evidence is passing, but real-data browser regression and representative browser production behavior evidence remain pending before M5-5 exit.
- The independent production UI audit remains separately gated by measured current-day headroom and collector health.
- M6 plans and M6-I1 fixture catalog are prepared, but M6 execution remains blocked until M5-5 exit.
- Explorer v1 implementation remains blocked until M5-5 exit plus the M6 integrity/reset and runtime/resource start gates.
- Final-host SEO binding and remaining M6 release hardening remain pending in roadmap order.
- Observatory O1-O3 remains post-release and post-soak work.
