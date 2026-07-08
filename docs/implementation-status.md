# Implementation status

Last updated: 2026-07-08.

## Current phase

The canonical-history and replacement-base cutover is complete on XRPL Devnet. Production history runs in verified hybrid mode: immutable canonical history covers ledgers `3371676..3432924`, and D1 live continuation covers the boundary after ledger `3432924`. The active current-state base is `devnet-3432924-canonical` at ledger `3432924`.

Post-cutover monitoring remains permanent: a lightweight runtime monitor runs every 30 minutes and guarded deep semantic diagnostics run every 6 hours. Deep diagnostics respect the existing D1 read guard.

The latest captured bounded semantic probe at 2026-07-07 21:08 UTC showed:

- collector healthy;
- cursor `3472761` and observed head `3472781`;
- public collector lag `0`;
- consecutive failures `0`;
- current error `null`;
- contiguous processed continuation `3432925..3472761`;
- `39837` processed ledgers;
- `0` discontinuities.

The same probe observed the previously missing real post-boundary unimpairment path. HYB-7 continuation diagnostics passed with every required path observed, including one `unimpaired` lifecycle transition with latest ledger `3470076`, matching managed-transition evidence, and `liveContinuation` became observed. No deliberate external witness is required while this natural validated evidence remains consistent.

The M1 diagnostic report from that semantic probe was not yet ready only because strict `validatedHeadReached` remained missing: the processed cursor was `3472761` while the observed head was `3472781`. `verifiedBaseBinding`, `catchUpStart`, and `liveContinuation` were observed.

A later bounded lightweight head recheck captured at 2026-07-07 21:57 UTC sampled the public collector three times over 40 seconds. Every sample was healthy with cursor and observed head both `3473715`, reported lag `0`, zero consecutive failures, no current error, and exact cursor/head equality. This proves that the prior 20-ledger cursor-to-observed-head gap closed. It does not by itself replace the guarded M1 diagnostics or the reproducible readiness-enforced exit review.

The production screenshot-audit workflow, capture hardening, deterministic evidence summarization, and strict technical evaluation are merged. The capture path waits for settled page state and records route/profile/detail-ID manifest data, overflow diagnostics, console errors, page errors, and HTTP error responses. The analyzer writes machine-readable JSON and human-readable Markdown summaries, requires exact expected route/profile capture coverage, rejects missing, duplicate, and unexpected diagnostic records, classifies page-level horizontal overflow separately from nested overflow review candidates, and fails the audit after writing evidence when strict technical checks do not pass. Human screenshot review remains required even when technical evaluation passes.

The production screenshot-audit and unimpairment candidate-review workflows share a fail-closed actual D1 headroom check. After collector preflight and before Playwright installation, page traversal, or candidate-list discovery, the workflow queries current UTC-day D1 analytics, records a public-safe usage summary, and requires both rows-read and rows-written fractions to remain below the existing `0.8` threshold. Manual confirmation remains an operator-intent gate but no longer substitutes for measured usage.

A bounded one-shot 2026-07-08 UTC operation is scheduled in the active path: the M1 exit review at 00:10 UTC with readiness enforcement enabled for the scheduled run, followed by the production UI audit at 00:30 UTC. The M1 review preserves its evidence artifact even when strict readiness is not yet satisfied. The UI audit independently rechecks collector health and actual D1 headroom before any Playwright installation or page crawl. Candidate review is not scheduled because natural unimpairment evidence is already observed and consistent. Both schedules are date-guarded so later annual cron matches no-op outside the explicit 2026-07-08 UTC window.

Route-aware SEO/discoverability preparation is implemented. Canonical and structured-data output remain inactive until an explicit public-site origin is configured, sitemap output is generated only when the final public origin is configured, and GA4 remains inactive until a valid measurement ID is supplied.

M1 exit is complete. M5-5 real-data integration is now active; M6 remains gated behind M5-5 and its production evidence.

The first D1-gated M5-5 production cross-audit passed at 2026-07-08 00:52:38 UTC. It verified shared snapshot identity across current entities, live Loan to Loan Broker and Loan Broker to Vault relationships, lifecycle-backed current/history consistency, lifecycle/current consistency, exact archive availability plus current-state exclusion, Activity result-code classification, Cover & Loss evidence availability, bounded Activity exports and feed output, Overview snapshot identity, and collector freshness. A durable manual workflow now repeats the same audit only after healthy zero-lag collector preflight and the unchanged measured D1 headroom gate pass. Real-data browser regression and representative browser production behavior smoke remain active before M5-5 exit.

The first M5-5 real-data browser regression probe exposed a focused prerequisite before the browser matrix can pass. A representative Loan detail route rendered an explicit Object History error because a UI-shaped `limit=25` exact-object history request could not complete through the generic bounded immutable segment-chain scan. The collector and D1 headroom preflights were healthy. The active prerequisite therefore routes exact Object History and per-Loan lifecycle detail through the already verified immutable exact index and bounded targeted segment-file reads, then merges post-boundary D1 continuation at the same canonical history boundary. Object History remains newest-first; Loan lifecycle detail remains oldest-first. The fallback generic scan remains available for configured hybrid sources without a verified exact index. This focused work does not change the collector, D1 schema, persistence boundary, deployment configuration, or public write surface.

## Approved Explorer and Observatory sequence

The approved product-evolution order is now:

```text
M5-5 completion
  -> M6 integrity/reset and runtime/resource guardrails
  -> Explorer v1
  -> remaining M6 visual/release hardening
  -> public Devnet release and real soak
  -> O1 XRPL Lending Observatory data foundation
  -> O2 Observatory monitoring view
  -> O3 Explorer v2
```

This approval does not make Explorer v1 the active implementation unit yet. The active unit remains M5-5 browser integration and the independently guarded production UI-audit path.

Explorer v1 is intentionally bounded to a guided presentation layer over approved API contracts. It must not introduce a new collector, new scheduled job, request-time full-history scan, or Explorer-specific analytics pipeline.

Explorer v2 is explicitly gated behind stable Observatory data contracts and the Observatory monitoring view. It must not define new historical metrics ad hoc.

The authoritative detailed contracts are:

- `docs/explorer-spec.md`;
- `docs/observatory-roadmap.md`.

These documents must be re-read with the active roadmap and this status document before every Explorer or Observatory implementation unit.

## Latest resource evidence

The 2026-07-07 21:09 UTC audit-headroom retry probe recorded:

- rows read: `10,590,963`;
- rows written: `241,785`;
- reference allowances: `5,000,000` rows read and `100,000` rows written per UTC day;
- measured headroom gate: failed.

The gate correctly stopped candidate discovery. Production screenshot crawl remains deferred until a new UTC-day measurement passes both read and write thresholds. Candidate review is no longer active while natural unimpairment evidence remains valid and consistent. The UI gate remains unchanged and is not bypassed by the scheduled operation or by the later lightweight exact-head evidence.

The 2026-07-08 00:52 UTC M5-5 production cross-audit probe measured `946,159` rows read and `3,414` rows written for the UTC day. Read and write fractions were approximately `18.92%` and `3.41%` of the configured daily reference allowances, so the unchanged below-80% gate passed. The production screenshot audit remains independently gated and must remeasure current-day usage before crawling.

## Latest HYB-7 state

- `createdCurrent`: observed;
- `modifiedCurrent`: observed;
- `deletionArchive`: observed;
- `ledgerContinuity`: observed;
- `cursorOverlay`: observed;
- `loanPayment`: observed;
- `defaulted`: observed;
- `activityHistoryBalance`: observed;
- `impaired`: observed;
- `unimpaired`: observed;
- `freshness`: observed;
- continuation report: passed.

## M1 exit result

At 2026-07-08 00:13:44 UTC, retained D1-gated evidence recorded collector healthy with cursor and observed head both `3476415`, lag `0`, zero consecutive failures, no current error, HYB-7 `passed: true` with every path observed, and M1 diagnostics `ready: true` with `verifiedBaseBinding`, `catchUpStart`, `validatedHeadReached`, and `liveContinuation` all observed. Bounded replacement-base, hybrid-history, Overview, and current list/detail exact-read checks also passed.

## Latest M1 evidence

From the 2026-07-07 21:08 UTC semantic probe:

- `verifiedBaseBinding`: observed;
- `catchUpStart`: observed;
- `validatedHeadReached`: missing in that diagnostic state because cursor `3472761` had not yet reached observed head `3472781`;
- `liveContinuation`: observed;
- overall M1 readiness: false in that diagnostic state.

From the 2026-07-07 21:57 UTC lightweight head recheck:

- three of three samples healthy;
- cursor `3473715`;
- observed head `3473715`;
- exact cursor/head equality: true in all samples;
- reported lag `0`;
- consecutive failures `0`;
- current error `null`.

The lightweight recheck closes the operational cursor/head gap but does not independently mutate the earlier M1 diagnostic report. The scheduled readiness-enforced M1 exit review must confirm the complete gate set together.

## M1 exit review

The `.github/workflows/m1-exit-review.yml` workflow captures a reproducible read-only evidence package. Manual dispatch retains the existing optional `require_ready` input. The date-guarded scheduled run enforces readiness. Readiness enforcement requires every HYB-7 path and M1 gate to be observed, collector lag equal to zero, zero consecutive failures, and expected replacement-base, hybrid-history, Overview, and exact current-state bindings.

A retained 2026-07-08 UTC D1-gated exit probe subsequently passed all readiness conditions together: collector healthy at exact head, HYB-7 passed with every path observed, and M1 diagnostics reported `ready: true` with every gate observed. M1 is therefore complete.

## Latest M5-5 production cross-audit result

At 2026-07-08 00:52:38 UTC, the D1-gated production cross-audit passed with:

- collector healthy, cursor/head `3477191`, lag `0`, consecutive failures `0`;
- active snapshot `devnet-3432924-canonical` at ledger `3432924`, with Overview snapshot match;
- 25 current Vaults, 25 Loan Brokers, and 25 Loans sampled from bounded list reads;
- Loan to Loan Broker and Loan Broker to Vault live relationship checks consistent;
- one lifecycle-backed current Loan matched one bounded newest object-history row and indexed lifecycle evidence;
- Lifecycle explorer: 100 rows;
- archived Loan exact lookup available and same object excluded from current state with HTTP `404`;
- Activity: 100 rows, including 77 `tesSUCCESS` and 23 non-success protocol transactions, classified rather than rejected;
- Archived Objects: 25 rows;
- Cover & Loss: 100 rows;
- Activity JSON, NDJSON, CSV, and feed NDJSON outputs: 25 bounded rows each;
- D1 usage: 946,159 rows read and 3,414 rows written; headroom gate passed;
- audit result: passed;
- human screenshot review remains separately required.

## Active unit

The active work is split into permanent monitoring plus two coordinated tracks.

### Permanent monitoring

1. Maintain the 30-minute lightweight runtime monitor.
2. Maintain the guarded 6-hour deep semantic diagnostics.
3. Preserve source identity, cursor/overlay agreement, zero-failure operation, and actual D1 usage visibility.
4. Do not retune collector limits or weaken D1 guards without measured evidence.

### Track A — M5-5 real-data integration

1. Preserve permanent monitoring, completed M1 exit evidence, and the passing D1-gated production cross-audit artifact.
2. Keep the durable production cross-audit workflow available for repeatable API-level checks after healthy collector and measured D1 headroom gates pass.
3. Treat current/history, lifecycle/current, archive/current exclusion, live relationships, bounded exports/feed, snapshot identity, Activity result classification, and freshness/lag API checks as observed in retained evidence.
4. Complete the focused exact-index prerequisite exposed by the first browser probe: Object History and per-Loan lifecycle detail must use bounded exact targeted immutable reads plus post-boundary D1 continuation without broadening collector or database work.
5. Re-run real-data browser regression across representative current, history, audit, Search, and Network Status routes after that prerequisite is deployed.
6. Run representative browser production behavior smoke with live identifiers and verify rendered relationship, archive/current, history/current, lifecycle/current, and freshness consistency.
7. Reconcile M5-5 exit only after the browser regression and representative browser smoke pass.

### Track B — production UI audit

1. Let the scheduled 00:30 UTC production audit attempt proceed only when measured headroom and healthy zero-lag collector preflight both pass.
2. Inspect the generated JSON/Markdown technical summary, raw manifest and diagnostics, and screenshots together; technical evaluation accelerates and enforces triage but does not replace human visual review.
3. Remediate confirmed UI defects and re-audit affected routes.

Tracks A and B may progress in parallel. Neither may weaken collector integrity or D1 resource guards.

## Next order

1. Keep permanent monitoring active.
2. Preserve the passing M5-5 API cross-audit evidence and durable D1-gated repeat workflow.
3. Complete and validate the exact-index Object History and Loan lifecycle detail prerequisite exposed by the real-data browser probe.
4. Re-run real-data browser regression and representative browser production behavior smoke across the roadmap route set, using live identifiers and checking relationship, archive/current, history/current, lifecycle/current, and freshness presentation consistency.
5. Reconcile M5-5 exit only from browser evidence; do not treat API cross-audit success as a substitute for browser regression.
6. In parallel, run the independently D1-gated production UI audit when measured headroom permits; inspect summaries, diagnostics, and screenshots, then remediate and re-audit confirmed defects.
7. After M5-5 exits, begin M6 integrity/reset simulation and runtime/resource guardrail work.
8. After those early M6 guardrails are established, execute Explorer v1 E1-1 through E1-5 from `docs/observatory-roadmap.md` without adding a new collector or scheduled job.
9. Continue remaining M6 final visual audit, accessibility, performance, security, cross-browser, discoverability, operations, recovery, soak, and final release verification with `/explore` included in the release surface.
10. Only after the stable Monitor release boundary and real soak evidence, begin O1 Observatory data-foundation specification and resource design.
11. Build the Observatory monitoring view only after O1 contracts are stable.
12. Build Explorer v2 only after the Observatory monitoring view establishes canonical metric interpretation and stable bounded APIs.

## Remaining blockers

- The 2026-07-08 00:52 UTC M5-5 production cross-audit probe measured 946,159 rows read and 3,414 rows written for the UTC day. Read and write fractions were approximately 18.92% and 3.41% of the configured daily reference allowances, so the unchanged below-80% gate passed. The production screenshot audit remains independently gated and must remeasure current-day usage before crawling.
- The first real-data browser probe exposed an Object History `bounded_immutable_scan_incomplete` error on a representative Loan detail route. The exact-index targeted-read prerequisite must pass CI, deploy, and then pass the browser regression re-run.
- M5-5 API cross-audit evidence is passing, but real-data browser regression and representative browser production behavior smoke remain pending before M5-5 exit.
- Final-host SEO binding and M6 release hardening remain pending in roadmap order.
- Explorer v1 is approved but not active until M5-5 exits and the early M6 resource guardrail start gate is satisfied.
- Observatory O1-O3 work is approved in sequence but remains post-release and post-soak work.
