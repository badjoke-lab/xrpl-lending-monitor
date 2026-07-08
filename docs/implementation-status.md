# Implementation status

Last updated: 2026-07-08.

## Current phase

The canonical-history and replacement-base cutover is complete on XRPL Devnet. Production history runs in verified hybrid mode: immutable canonical history covers ledgers `3371676..3432924`, and D1 live continuation covers the boundary after ledger `3432924`. The active current-state base is `devnet-3432924-canonical` at ledger `3432924`.

Post-cutover monitoring remains permanent:

- lightweight runtime monitoring every 30 minutes;
- guarded deep semantic diagnostics every 6 hours;
- deep diagnostics remain subject to the existing D1 read guard.

M1 exit is complete. M5-5 real-data integration is active. M6 remains gated behind M5-5 browser evidence and has not started.

The first D1-gated M5-5 production cross-audit passed at `2026-07-08 00:52:38 UTC`. API-level current/history, lifecycle/current, archive/current exclusion, live relationship, bounded export/feed, snapshot identity, Activity result classification, Cover & Loss availability, and freshness/lag checks are retained as passing evidence.

The durable production browser-regression path is merged and validated in CI. It discovers bounded live witnesses, traverses 15 representative routes, performs relationship/history/archive/Search/freshness behavior checks, records request-count evidence, retains `runner.log`, and fails on rendered state errors, console errors, page errors, HTTP 5xx findings, or missing required behavior.

The browser runner read-budget optimization is merged. The preferred lifecycle-backed current Loan is selected by in-memory intersection of bounded current Loan and Lifecycle windows. Normal selection uses zero additional lifecycle witness detail probes; fallback is capped at four unique non-deleted candidates. Behavior assertions run during the same 15-route traversal instead of duplicate page revisits.

A fail-closed M5-5 browser exit evaluator is merged. It verifies:

- exact 15-route coverage with no missing, duplicate, or unexpected route evidence;
- exact required behavior-check coverage and passing results;
- zero technical findings;
- healthy collector evidence and preflight state;
- numerical D1 headroom consistency below the recorded threshold;
- approved bounded lifecycle witness selection mode and probe count;
- discovery logical request, HTTP attempt, and browser API request evidence.

The evaluator writes `exit-evaluation.json` and `exit-evaluation.md`. A passing browser evaluator marks browser evidence ready for M5-5 exit reconciliation, but retained API cross-audit evidence remains a separate prerequisite. Human screenshot review remains a separate Track B requirement.

A date-guarded production browser-regression attempt is scheduled for `2026-07-09 00:45 UTC` (`2026-07-09 09:45 JST`), after the next UTC-day D1 usage reset and after the permanent `00:23 UTC` deep-diagnostics window. The deep diagnostics job has a 15-minute timeout, so the later browser start intentionally avoids planned overlap between deep evidence scans and production browser traversal. The scheduled path uses the same healthy zero-lag collector preflight and unchanged below-80% D1 headroom gate as manual execution. Outside the exact date, the annual cron shape performs no checkout, D1 query, dependency installation, Playwright installation, browser traversal, summary publication, or artifact upload.

## Latest retained runtime evidence

### HYB-7 and M1

The bounded semantic probe at `2026-07-07 21:08 UTC` recorded:

- collector healthy;
- cursor `3472761`, observed head `3472781`;
- public collector lag `0`;
- consecutive failures `0`;
- current error `null`;
- contiguous processed continuation `3432925..3472761`;
- `39837` processed ledgers;
- `0` discontinuities;
- every HYB-7 path observed, including natural post-boundary unimpairment evidence.

A later bounded head recheck at `2026-07-07 21:57 UTC` sampled the public collector three times over 40 seconds. Every sample was healthy with cursor and observed head both `3473715`, reported lag `0`, zero consecutive failures, and no current error.

At `2026-07-08 00:13:44 UTC`, retained D1-gated M1 exit evidence recorded:

- collector healthy;
- cursor and observed head both `3476415`;
- lag `0`;
- consecutive failures `0`;
- current error `null`;
- HYB-7 `passed: true` with every path observed;
- M1 diagnostics `ready: true`;
- `verifiedBaseBinding`, `catchUpStart`, `validatedHeadReached`, and `liveContinuation` all observed;
- bounded replacement-base, hybrid-history, Overview, and current list/detail exact-read checks passed.

### M5-5 production cross-audit

At `2026-07-08 00:52:38 UTC`, the D1-gated production cross-audit passed with:

- collector healthy, cursor/head `3477191`, lag `0`, consecutive failures `0`;
- active snapshot `devnet-3432924-canonical` at ledger `3432924`, with Overview snapshot match;
- 25 current Vaults, 25 Loan Brokers, and 25 Loans sampled from bounded list reads;
- Loan -> Loan Broker and Loan Broker -> Vault relationship checks consistent;
- one lifecycle-backed current Loan matched indexed lifecycle and bounded newest object-history evidence;
- Lifecycle explorer: 100 rows;
- exact archived Loan available and excluded from current state with HTTP `404`;
- Activity: 100 rows, including 77 `tesSUCCESS` and 23 non-success protocol transactions, classified rather than rejected;
- Archived Objects: 25 rows;
- Cover & Loss: 100 rows;
- Activity JSON, NDJSON, CSV, and feed NDJSON outputs: 25 bounded rows each;
- D1 usage: 946,159 rows read and 3,414 rows written;
- headroom gate passed;
- audit result passed.

### Browser prerequisite and resource gate

The first real-data browser probe exposed a focused Object History prerequisite on a representative Loan detail route. The exact-history fix is merged: Object History and per-Loan lifecycle detail use the verified immutable exact index and bounded targeted reads, then merge post-boundary D1 continuation at the same canonical boundary. Object History remains newest-first and Loan lifecycle detail remains oldest-first.

A later production-shaped browser attempt at `2026-07-08 04:12 UTC` recorded:

- collector preflight passed;
- rows read: `4,209,732 / 5,000,000`;
- rows written: `25,806 / 100,000`;
- read fraction approximately `84.19%`;
- write fraction approximately `25.81%`;
- below-80% headroom gate failed;
- browser traversal did not start.

No browser pass is claimed from that attempt. The gate remains unchanged.

## Explorer v1 pre-entry design preparation

A documentation-only Explorer v1 pre-entry design preparation unit is complete in the current branch and awaiting normal PR validation/merge.

This preparation does not start E1-1 and does not change runtime behavior, public routes, API contracts, collector behavior, D1 persistence, schedules, deployment, or resource thresholds.

The accepted visual direction is:

> Guided Dashboard + Relationship Explorer hybrid.

The accepted page hierarchy is:

```text
Hero and scope
  -> Three concepts
  -> Current snapshot
  -> Conceptual protocol flow
  -> Bounded observed relationships
  -> Selected Loan
  -> Recent Activity translation
  -> How to read this page / glossary
  -> Technical view transition
```

The Hero remains visually aligned with the current XRPL Lending Monitor application and explicitly excludes lighthouse, observatory-building, scenic landscape, or other decorative Hero illustration.

Prepared documents:

- `docs/explorer-v1-visual-direction.md`;
- `docs/explorer-v1-contract-matrix.md`;
- `docs/explorer-v1-translation-dictionary.md`;
- `docs/explorer-v1-relationship-contract.md`.

The preparation establishes:

- accepted visual composition;
- section-to-candidate-contract mapping;
- initial-load versus lazy-load boundaries;
- unsupported metric prohibitions;
- plain-language concept and field dictionary;
- success/non-success Activity translation framework;
- conservative fallback translation rule;
- bounded relationship anchor/loading models;
- same-network, same-epoch, same-base-context relationship rules;
- semantic relationship-list alternative requirements;
- mobile relationship-layout direction;
- measurement hooks required by the M6 Explorer resource harness.

Unresolved endpoint selection, numeric relationship caps, request budgets, and any dedicated composition endpoint decision remain deferred to measured E1-1 review after the start gate opens.

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

Explorer v2 remains gated behind stable Observatory data contracts and the Observatory monitoring view. It must not define new metrics ad hoc.

The detailed early M6 pre-entry plans are prepared but inactive until M5-5 exits:

- `docs/m6-integrity-reset-plan.md`;
- `docs/m6-resource-guardrail-plan.md`.

The detailed Explorer and Observatory contracts are:

- `docs/explorer-spec.md`;
- `docs/observatory-roadmap.md`;
- `docs/explorer-v1-visual-direction.md`;
- `docs/explorer-v1-contract-matrix.md`;
- `docs/explorer-v1-translation-dictionary.md`;
- `docs/explorer-v1-relationship-contract.md`.

## Active unit

The active work remains permanent monitoring plus two coordinated M5-5/UI tracks. Explorer pre-entry preparation does not change the active implementation gate.

### Permanent monitoring

1. Maintain the 30-minute lightweight runtime monitor.
2. Maintain the guarded 6-hour deep semantic diagnostics.
3. Preserve source identity, cursor/overlay agreement, zero-failure operation, and actual D1 usage visibility.
4. Do not retune collector limits or weaken D1 guards without measured evidence.

### Track A — M5-5 real-data integration

1. Preserve completed M1 exit evidence and passing M5-5 API cross-audit evidence.
2. Preserve the exact-index Object History and Loan lifecycle detail prerequisite.
3. Preserve the optimized durable D1-gated browser regression workflow, request-count evidence, runner-log retention, and fail-closed exit evaluator.
4. Let the `2026-07-09 00:45 UTC` date-guarded run proceed only after the planned deep-diagnostics window and only through unchanged collector and D1 headroom gates.
5. Inspect `summary.json`, `summary.md`, `runner.log`, `exit-evaluation.json`, `exit-evaluation.md`, collector preflight, and D1 headroom evidence.
6. Reconcile M5-5 exit only if retained API cross-audit evidence remains valid and browser exit evidence passes.

### Track B — production UI audit

1. Run production screenshot audit only when measured headroom and healthy zero-lag collector preflight both pass.
2. Inspect technical summaries, raw manifest/diagnostics, and screenshots together.
3. Remediate confirmed defects and re-audit affected routes.
4. Preserve mandatory human visual review even when strict technical evaluation passes.

Tracks A and B may progress in parallel. Neither may weaken collector integrity or resource guards.

## Prepared post-M5-5 units

Preparation is complete for the first two M6 units, but execution has not started.

### M6 integrity/reset baseline

`docs/m6-integrity-reset-plan.md` defines:

- deterministic integrity fixture matrix;
- atomicity, interruption, and replay scenarios;
- reset-signal classification;
- local deterministic epoch-transition rehearsal;
- bounded catch-up, stale/fresh transition, and reconciliation baseline;
- machine-readable and human-readable evidence requirements.

### M6 runtime/resource guardrail baseline

`docs/m6-resource-guardrail-plan.md` defines:

- collector normal-run measurement;
- replay and catch-up measurement;
- representative current/history/audit/system API read measurement;
- production browser request-shape measurement;
- Explorer v1 guardrail harness contract;
- evidence schema and budget-approval process.

No new per-route numeric budget has been invented before measurement. The existing D1 headroom gate remains authoritative.

## Next order

1. Keep permanent monitoring active.
2. Merge the Explorer v1 pre-entry design preparation only after documentation review/CI confirms no schedule or source-of-truth contradiction.
3. Let the date-guarded `2026-07-09 00:45 UTC` browser-regression attempt run after the planned deep-diagnostics window, evaluate collector health and current-day D1 headroom, then traverse only if both gates pass.
4. Inspect all retained browser, resource, and exit-evaluator artifacts.
5. Reconcile M5-5 exit only when retained API and new browser evidence both satisfy their gates.
6. After M5-5 exits, begin `M6-I1` from `docs/m6-integrity-reset-plan.md`.
7. Complete the integrity/reset baseline in M6-I1 through M6-I5 order.
8. Then execute M6-R1 through M6-R5 preparation order from `docs/m6-resource-guardrail-plan.md`.
9. Begin Explorer v1 E1-1 only after its M5-5, integrity/reset, and resource-guardrail start gates are satisfied; revalidate all pre-entry Explorer documents against actual M6 evidence.
10. Continue E1-2 through E1-5 in `observatory-roadmap.md` order.
11. Continue remaining M6 visual, accessibility, performance, security, cross-browser, discoverability, operations, recovery, soak, and final release gates with `/explore` included in the release surface.
12. Only after stable Monitor release and real soak evidence, begin O1 Observatory data-foundation work.
13. Build the Observatory monitoring view only after O1 contracts are stable.
14. Build Explorer v2 only after O2 establishes canonical technical interpretation and stable bounded APIs.

## Remaining blockers

- The next production-shaped browser evidence attempt is scheduled for `2026-07-09 00:45 UTC` and intentionally isolated from the planned `00:23 UTC` deep-diagnostics window; it remains subject to unchanged healthy zero-lag collector and below-80% current-day D1 headroom gates.
- M5-5 API cross-audit evidence is passing, but real-data browser regression and representative browser production behavior evidence remain pending before M5-5 exit.
- The independent production UI audit remains separately gated by measured current-day headroom and collector health.
- M6 plans are prepared but M6 execution remains blocked until M5-5 exit.
- Explorer v1 pre-entry design preparation is documentation-only and does not satisfy the Explorer start gate.
- Explorer v1 implementation remains blocked until M5-5 exit plus the M6 integrity/reset and runtime/resource start gates.
- Final-host SEO binding and remaining M6 release hardening remain pending in roadmap order.
- Observatory O1-O3 remains post-release and post-soak work.
