# Implementation status

Last updated: 2026-07-10.

## Current phase

The canonical-history and replacement-base cutover is complete on XRPL Devnet. Production history runs in verified hybrid mode: immutable canonical history covers ledgers `3371676..3432924`, and D1 live continuation covers the boundary after ledger `3432924`. The active current-state base is `devnet-3432924-canonical` at ledger `3432924`.

M1 exit is complete. M5-5 real-data integration remains active. M6 remains gated behind M5-5 browser evidence and has not started.

The retained M5-5 API-level production cross-audit evidence from `2026-07-08 00:52:38 UTC` remains passing. The remaining M5-5 exit requirement is production-shaped browser evidence plus the fail-closed browser exit evaluator.

## Active recovery — Cloudflare Free collector throughput

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

PR #299 then tested 64 ledgers/run after the UTC daily reset. Runtime monitor run `29060806372` failed in both lightweight and deep diagnostics. The first lightweight artifact recorded:

- `cursor_delta=0`;
- `head_delta=175`;
- `lag_delta=+175`;
- `samples_with_failures=3`;
- three consecutive collector samples with `Too many subrequests by single Worker invocation`.

The cursor remained at ledger `3501250` while observed head advanced from `3531143` to `3531318`. This was a per-invocation subrequest failure, not a CPU exhaustion result.

PR #301 immediately restored the last retained passing five-minute 32-ledger/run profile. CI and Release-native CI passed before merge.

The rerun of runtime monitor run `29060806372` then passed both `deep-diagnostics` and `lightweight-monitor`. The retained rerun lightweight artifact recorded:

- first cursor/head/lag: `3501282 / 3532832 / 31550`;
- last cursor/head/lag: `3501346 / 3533007 / 31661`;
- `cursor_delta=64`;
- `head_delta=175`;
- `lag_delta=+111`;
- `samples=3`;
- `samples_with_failures=0`;
- `ledgers_processed=32` and `rpc_requests=32` in the first and last samples;
- run duration approximately `6.8s` in the first and last samples;
- D1 rows read at capture: `2,429,539 / 5,000,000`;
- D1 rows written at capture: `404 / 100,000`.

Therefore the collector is recovered but remains materially behind. The 32-ledger HTTP profile is the temporary production safety baseline, not a catch-up-grade capacity solution. Configuration-only HTTP increases above this baseline are blocked. The active design direction is documented in `docs/ops/free-tier-collector-throughput-design-2026-07-10.md`.

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

The active implementation unit is T1 from `docs/ops/free-tier-collector-throughput-design-2026-07-10.md`: add a tested XRPL WebSocket ledger-transport seam without changing production behavior.

The unit boundary is:

1. Keep production cron at five-minute cadence and keep the 32-ledger HTTP rollback profile unchanged.
2. Add a collector-cycle-scoped WebSocket ledger session behind the existing ledger reader boundary.
3. Parse WebSocket responses into the existing `ValidatedLedgerRead` contract.
4. Preserve exact requested-ledger checks, parent-hash continuity, budget selection, guarded D1 commit, and cursor atomicity.
5. Add deterministic request-correlation, timeout, malformed-response, close/error, continuity, and no-partial-commit tests.
6. Keep production wiring disabled until a non-production Devnet WSS probe passes.
7. After the probe, run a production 32-ledger transport canary before any 64-ledger WebSocket throughput test.

Track A — M5-5 browser evidence — remains blocked until collector capacity and freshness are adequate for valid production-shaped evidence. Track B — production UI audit — also remains gated by measured current-day headroom and collector health.

Neither track may weaken collector integrity, D1 resource gates, or browser exit criteria.

## Prepared post-M5-5 units

Preparation is complete for the first two M6 hardening areas, but execution has not started.

- `docs/m6-integrity-reset-plan.md` defines the first executable M6 integrity/reset baseline after M5-5 exit.
- `docs/m6-i1-fixture-catalog.md` prepares deterministic M6-I1 F00-F14 scenarios, shared context/object/asset families, evidence snapshot requirements, and M6-I2-I5 reuse.
- `docs/m6-resource-guardrail-plan.md` defines the early M6 runtime/resource measurement order, evidence contract, budget-approval process, and Explorer v1 resource-harness gate.

M6-I1 may begin only after M5-5 exits and after issue #283, the fixture catalog, and existing helper inventory are reviewed.

## Next order

1. Implement T1 WebSocket transport seam and deterministic tests without changing production configuration.
2. Run the bounded non-production Devnet WSS probe and retain connection, logical-message, wall-time, response, and continuity evidence.
3. Only after the probe passes, run a production 32-ledger WebSocket transport canary.
4. Only after the canary passes, test a 64-ledger WebSocket profile with one retained runtime monitor artifact.
5. Select any higher capacity target from measured head slope, transport wall time, CPU outcome, D1 usage, and retained runtime evidence rather than configuration arithmetic alone.
6. Run or rerun M5-5 browser regression only after collector preflight and D1 headroom gates pass and the collector is sufficiently current for production-shaped evidence.
7. Inspect `summary.json`, `summary.md`, `runner.log`, `exit-evaluation.json`, `exit-evaluation.md`, collector preflight, and D1 headroom evidence.
8. Reconcile M5-5 exit only when retained API and browser evidence both satisfy their gates.
9. After M5-5 exits, begin M6-I1 using `docs/m6-integrity-reset-plan.md`, `docs/m6-i1-fixture-catalog.md`, and issue #283 after inventorying existing helpers.

## Remaining blockers

- The production collector is recovered at the five-minute 32-ledger HTTP profile, but retained evidence still shows growing lag and no catch-up-grade capacity.
- The 64-ledger HTTP profile is rejected because it exceeds the Worker per-invocation subrequest limit and stops cursor advancement.
- A tested lower-subrequest transport path does not yet exist; T1 WebSocket transport work is the active unit.
- M5-5 API cross-audit evidence is passing, but real-data browser regression and representative browser production behavior evidence remain pending before M5-5 exit.
- The independent production UI audit remains separately gated by measured current-day headroom and collector health.
- M6 plans and M6-I1 fixture catalog are prepared, but M6 execution remains blocked until M5-5 exit.
- Explorer v1 implementation remains blocked until M5-5 exit plus the M6 integrity/reset and runtime/resource start gates.
- Final-host SEO binding and remaining M6 release hardening remain pending in roadmap order.
- Observatory O1-O3 remains post-release and post-soak work.
