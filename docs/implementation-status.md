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

Therefore the collector is recovered but remains materially behind. Configuration-only HTTP increases above the passing 32-ledger profile are blocked. The active design direction is documented in `docs/ops/free-tier-collector-throughput-design-2026-07-10.md`.

T1 provides a WebSocket ledger-transport seam behind the existing reader contract. HTTP and WebSocket paths share the same validated-ledger parser. The WebSocket session uses unique request IDs, supports correlated out-of-order responses, separates connection and logical-message usage, fails closed on ambiguous or invalid responses, and guarantees scoped close behavior. Deterministic coverage includes correlation, timeout, malformed JSON, XRPL error, wrong ledger identity, connection error, unexpected close, success/failure finalization, and no commit after an incomplete scan.

T2 bounded non-production Devnet WSS probe run `29066850176` passed and retained artifact `8217450764`. The read-only probe fixed validated head `3534008` with hash `C1ED28988F304695134502DAB4CEA279F8C8A33E253940908EB15CDDB001D018`, read anchor ledger `3533944`, then scanned the contiguous 64-ledger range `3533945..3534008` through one WebSocket session. Retained transport evidence recorded `connections=1`, `logical_messages=65`, `successful_ledgers=65`, `response_failures=0`, `reconnects=0`, `continuity.passed=true`, exact first-parent/anchor-hash agreement, exact last-ledger/head-hash agreement, `522` inspected transactions, `77` Lending transactions, and `wall_time_ms=8837`.

T3 production 32-ledger WebSocket canary was merged in PR #305 and measured with runtime monitor run `29060806372`, retained lightweight artifact `8217720983`. The monitor passed all lightweight invariants and the two post-propagation WebSocket samples showed real production use of `wss://s.devnet.rippletest.net:51233/`, `endpoint_attempts=1`, zero consecutive failures, and `error=null`. However, the sequential WebSocket scan did not reach the configured 32-ledger maximum inside the existing execution window:

- WSS sample 1: cursor/head/lag `3501761 / 3534259 / 32498`, `ledgers_processed=17`, `rpc_requests=17`, `endpoint_attempts=1`, run duration `9932ms`;
- WSS sample 2: cursor/head/lag `3501781 / 3534353 / 32572`, `ledgers_processed=20`, `rpc_requests=20`, `endpoint_attempts=1`, run duration `9600ms`;
- WSS-only five-minute interval: `cursor_delta=20`, `head_delta=94`, `lag_delta=+74`;
- whole three-sample monitor window, including the pre-propagation HTTP first sample: `cursor_delta=37`, `head_delta=181`, `lag_delta=+144`, `samples_with_failures=0`;
- D1 rows read at capture: `2,457,495 / 5,000,000`;
- D1 rows written at capture: `20,574 / 100,000`.

T3 therefore passed the transport-safety canary but failed the throughput objective. The result proved one production Worker invocation could reuse one WebSocket connection without subrequest, continuity, persistence, or collector-failure evidence, but the sequential scan loop underused that transport. PR #306 restored the retained 32-ledger HTTP baseline before windowing work continued.

T3b added a bounded WebSocket read window while preserving default sequential behavior for HTTP and any unspecified scan. Requests inside one small window may be in flight concurrently, but the window is validated in ledger-index order before downstream budget selection or persistence. Execution-budget checks remain between windows, so no partial in-flight window is exposed as a commit range. Deterministic coverage includes concurrent window start, out-of-order completion with ordered output, one-request failure, wrong ledger identity, parent-hash discontinuity, deadline stop between windows, contiguous output, and configured WebSocket window routing.

T3b read-only Devnet WSS probe run `29068010305` passed with retained artifact `8217850468`. Window `4` read anchor plus contiguous range `3534542..3534605` through one connection. Evidence recorded `connections=1`, `logical_messages=65`, `successful_ledgers=65`, `response_failures=0`, `reconnects=0`, `continuity.passed=true`, exact first-parent/anchor-hash agreement, exact last-ledger/head-hash agreement, `735` inspected transactions, `110` Lending transactions, and `wall_time_ms=4103`. This was less than half the earlier sequential T2 probe wall time of `8837ms` while preserving the same 64-ledger range size plus one anchor message.

T3c production 32-ledger WebSocket canary with read window `4` was merged in PR #308 and measured with runtime monitor run `29060806372`, retained lightweight artifact `8218091748`. The first sample was pre-propagation HTTP; the two post-propagation WSS samples both processed the full configured 32-ledger batch through one connection with zero failures:

- WSS sample 1: cursor/head/lag `3501929 / 3534812 / 32883`, `ledgers_processed=32`, `rpc_requests=32`, `endpoint_attempts=1`, run duration `6588ms`, error `null`;
- WSS sample 2: cursor/head/lag `3501961 / 3534908 / 32947`, `ledgers_processed=32`, `rpc_requests=32`, `endpoint_attempts=1`, run duration `6546ms`, error `null`;
- whole three-sample monitor window: `cursor_delta=64`, `head_delta=189`, `lag_delta=+125`, `samples_with_failures=0`;
- D1 rows read at capture: `2,463,593 / 5,000,000` (`49.27186%`);
- D1 rows written at capture: `30,230 / 100,000` (`30.23%`).

T3c passed both safety and the 32-ledger capacity gate. Windowing removed the sequential WSS shortfall while retaining one connection and no collector failures. It authorized one temporary 64-ledger WSS throughput test, not automatic adoption of a sustained higher profile. D1 daily usage and catch-up slope remained independent gates.

T4 temporary production 64-ledger WSS window-4 test was merged in PR #309 and measured with runtime monitor run `29060806372`, retained lightweight artifact `8218342545`. Two post-propagation WSS64 samples each processed the full 64-ledger batch through one connection with zero failures and `error=null`; run duration was approximately `9.6s`. Across the retained sampled window, cursor advanced `+128`, observed head advanced `+192`, and lag grew `+64`. T4 therefore passed the transport and persistence safety gates but failed the catch-up objective under the observed head slope.

PR #310 restored the production-validated WSS32 window-4 baseline after T4. This is a control baseline for T5 resource measurement, not a reversal of the WebSocket architecture.

T5-1 measurement instrumentation was merged in PR #311. Runtime monitor artifact `8219138203` captured three measured WSS32 window-4 runs in a dense backlog region. Each run read 32 ledgers through one WSS endpoint attempt, but commit-prefix budgeting allowed only 9, 10, and 9 ledgers. Persistence rows written were 2493, 2578, and 2294. Across the window, cursor advanced `+19`, observed head advanced `+199`, and lag grew `+180`, with zero collector failures and `error=null`. The same artifact recorded D1 rows written `77,113 / 100,000` and rows read `3,759,947 / 5,000,000` at `2026-07-10T05:37Z`.

The measured dense-region result moves the active bottleneck from transport capacity to D1 persistence capacity. A temporary operational deployment changed production cadence to `0 */4 * * *`; the Cloudflare schedules API confirmed that exact active cron. The temporary deployment PR was closed without merge. The four-hour cadence is a D1 protection profile, not a catch-up profile.

Detailed evidence and the protection decision are recorded in `docs/ops/t5-d1-persistence-bottleneck-2026-07-10.md`.

## Latest retained runtime evidence

### HYB-7 and M1

The retained M1 exit evidence at `2026-07-08 00:13:44 UTC` recorded collector healthy, cursor/head `3476415`, lag `0`, zero consecutive failures, HYB-7 `passed: true`, M1 diagnostics `ready: true`, and bounded replacement-base, hybrid-history, Overview, and current list/detail exact-read checks passing.

### M5-5 production cross-audit

At `2026-07-08 00:52:38 UTC`, the D1-gated production cross-audit passed with collector healthy, cursor/head `3477191`, lag `0`, active snapshot `devnet-3432924-canonical`, sampled Vault/Broker/Loan relationships, lifecycle/current/history checks, archive exclusion, Activity classification, Cover & Loss availability, exports/feed, and D1 headroom passing.

### Browser prerequisite and resource gate

The durable production browser-regression path is merged and validated in CI. It discovers bounded live witnesses, traverses 15 representative public routes, performs relationship/history/archive/Search/freshness behavior checks, records request-count evidence, retains `runner.log`, and fails on rendered state errors, console errors, page errors, HTTP 5xx findings, or missing required behavior.

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
  -> remaining M6 release hardening
  -> public Devnet release and real soak
  -> O1 XRPL Lending Observatory data foundation
  -> O2 Observatory monitoring view
  -> O3 Explorer v2
```

Explorer v1 is a bounded presentation layer over approved contracts. It must not add a separate collector, scheduled job, request-time full-history scan, or Explorer-specific historical analytics pipeline.

## Active unit

The active operational unit is T5-2: resolve the measured D1 persistence bottleneck before any further production throughput increase.

The unit boundary is:

1. Keep production on WSS32 window-4 with the temporary four-hour protection cadence while the redesign is evaluated.
2. Treat artifact `8219138203` as the retained WSS32 dense-region baseline: 9/10/9 ledgers committed, persistence writes 2493/2578/2294, cursor `+19`, head `+199`, lag `+180`, zero failures.
3. Do not deploy the prepared WSS64 comparison while remaining current-day D1 write headroom is insufficient for the comparison plus rollback margin.
4. Do not run window-8 or 128-ledger production tests until D1 persistence cost is reduced or backlog history is moved out of the Worker/D1 hot path.
5. Evaluate D1 write amplification by table/index contract and identify only changes that preserve required public history, exact lookup, relationship, lifecycle, archive, balance-history, current overlay, and cursor integrity behavior.
6. Evaluate extension of the existing canonical-history segment pipeline from the current immutable boundary to a fixed verified catch-up target, including chain verification, publication, exact index, replacement-base/current-state cutover, and bounded live-tail continuation.
7. Prefer a fixed-target, fail-closed cutover design over parallel independent cursor writers or blind capacity increases.

Track A — M5-5 browser evidence — remains blocked until collector capacity and freshness are adequate for valid production-shaped evidence. Track B — production UI audit — also remains gated by measured current-day headroom and collector health.

Neither track may weaken collector integrity, D1 resource gates, or browser exit criteria.

## Prepared post-M5-5 units

Preparation is complete for the first two M6 hardening areas, but execution has not started.

- `docs/m6-integrity-reset-plan.md` defines the first executable M6 integrity/reset baseline after M5-5 exit.
- `docs/m6-i1-fixture-catalog.md` prepares deterministic M6-I1 F00-F14 scenarios, shared context/object/asset families, evidence snapshot requirements, and M6-I2-I5 reuse.
- `docs/m6-resource-guardrail-plan.md` defines the early M6 runtime/resource measurement order, evidence contract, budget-approval process, and Explorer v1 resource-harness gate.

M6-I1 may begin only after M5-5 exits and after issue #283, the fixture catalog, and existing helper inventory are reviewed.

## Next order

1. Merge and retain the D1 protection cadence in canonical `main` after CI and Release-native CI pass.
2. Inventory existing canonical-history continuation and replacement-current-state tooling against the required fixed-target catch-up cutover.
3. Produce a bounded T5-2 design that separates immutable backlog history generation from the Worker/D1 hot path without weakening current-state correctness or hybrid-history guarantees.
4. Implement the smallest missing deterministic tooling and run a non-production fixed-range rehearsal before any production cutover.
5. Keep WSS64, window-8, and 128-ledger production experiments blocked until resource evidence justifies reopening them.
6. Keep M5-5 browser regression blocked until collector preflight and D1 headroom gates pass and the collector is sufficiently current for production-shaped evidence.
7. Reconcile M5-5 exit only when retained API and browser evidence both satisfy their gates.
8. After M5-5 exits, begin M6-I1 using `docs/m6-integrity-reset-plan.md`, `docs/m6-i1-fixture-catalog.md`, and issue #283 after inventorying existing helpers.

## Remaining blockers

- Production uses a four-hour D1 protection cadence and is not in catch-up mode.
- The 64-ledger HTTP profile is rejected because it exceeds the Worker per-invocation subrequest limit and stops cursor advancement.
- T4 proved the 64-ledger WSS window-4 profile is technically safe in a sparse sampled region but did not outpace the sampled Devnet head growth.
- T5-1 proved dense backlog regions can hit persistence row/statement budgets long before the 32-ledger scan range is committed.
- Current-day D1 write usage reached `77,113 / 100,000` at the retained T5-1 capture, so further production throughput experiments are blocked by resource headroom.
- The canonical-history fixed-range pipeline exists, but a verified extension/cutover design from the current immutable boundary through a newer fixed target has not yet been approved or rehearsed.
- M5-5 API cross-audit evidence is passing, but real-data browser regression and representative browser production behavior evidence remain pending before M5-5 exit.
- The independent production UI audit remains separately gated by measured current-day headroom and collector health.
- M6 plans and M6-I1 fixture catalog are prepared, but M6 execution remains blocked until M5-5 exit.
- Explorer v1 implementation remains blocked until M5-5 exit plus the M6 integrity/reset and runtime/resource start gates.
- Final-host SEO binding and remaining M6 release hardening remain pending in roadmap order.
- Observatory O1-O3 remains post-release and post-soak work.
