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

## Latest resource evidence

The 2026-07-07 21:09 UTC audit-headroom retry probe recorded:

- rows read: `10,590,963`;
- rows written: `241,785`;
- reference allowances: `5,000,000` rows read and `100,000` rows written per UTC day;
- measured headroom gate: failed.

The gate correctly stopped candidate discovery. Production screenshot crawl remains deferred until a new UTC-day measurement passes both read and write thresholds. Candidate review is no longer active while natural unimpairment evidence remains valid and consistent. The UI gate remains unchanged and is not bypassed by the scheduled operation or by the later lightweight exact-head evidence.

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

## Active unit

The active work is split into permanent monitoring plus two coordinated tracks.

### Permanent monitoring

1. Maintain the 30-minute lightweight runtime monitor.
2. Maintain the guarded 6-hour deep semantic diagnostics.
3. Preserve source identity, cursor/overlay agreement, zero-failure operation, and actual D1 usage visibility.
4. Do not retune collector limits or weaken D1 guards without measured evidence.

### Track A — M5-5 real-data integration

1. Preserve permanent monitoring and the completed M1 exit evidence.
2. Cross-audit verified current state against indexed real history.
3. Validate bounded exports against the live evidence boundary.
4. Run real-data browser regression and current/history consistency checks.
5. Cross-check lifecycle/current-object consistency and archive/current exclusion.
6. Run bounded production behavior smoke and relationship checks across representative routes.
7. Verify freshness and lag claims against collector status.

### Track B — production UI audit

1. Let the scheduled 00:30 UTC production audit attempt proceed only when measured headroom and healthy zero-lag collector preflight both pass.
2. Inspect the generated JSON/Markdown technical summary, raw manifest and diagnostics, and screenshots together; technical evaluation accelerates and enforces triage but does not replace human visual review.
3. Remediate confirmed UI defects and re-audit affected routes.

Tracks A and B may progress in parallel. Neither may weaken collector integrity or D1 resource guards.

## Next order

1. Keep permanent monitoring active.
2. Execute M5-5 cross-audit real-data integration against the completed M1 state.
3. Complete bounded exports, browser regression, current/history and lifecycle/current consistency, archive/current exclusion, relationship verification, and bounded production behavior smoke.
4. In parallel, run the independently D1-gated production UI audit when measured headroom permits; inspect summaries, diagnostics, and screenshots, then remediate and re-audit confirmed defects.
5. After M5-5 exits, complete M6 integrity/reset simulations, runtime/resource guardrails, final visual audit, accessibility, performance, security, and cross-browser validation.
6. Bind SEO/discoverability to the final public host and complete owner-managed analytics and search setup.
7. Finalize operations/deployment documentation and recovery verification.
8. Complete the real multi-day Devnet soak and final release verification.

## Remaining blockers

- The 2026-07-08 00:13 UTC M1 exit probe measured fresh UTC-day D1 usage at 528 rows read and 1,168 rows written and passed the headroom gate. The production screenshot audit still applies its own independent current-day gate before crawling. Production screenshot audit remains deferred until a new current-day measurement passes; scheduling cannot bypass it.
- Production behavior smoke remains pending for the post-M1 M5-5 path.
- Final-host SEO binding and M6 release hardening remain pending in roadmap order.
