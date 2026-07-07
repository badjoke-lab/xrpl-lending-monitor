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

The M1 diagnostic report from that probe was not yet ready only because strict `validatedHeadReached` remained missing: the processed cursor was `3472761` while the observed head was `3472781`. `verifiedBaseBinding`, `catchUpStart`, and `liveContinuation` were observed. The next M1 action is therefore a later fresh-head recheck followed by the reproducible `require_ready=true` exit review only when all M1 gates are observed.

The production screenshot-audit workflow, capture hardening, deterministic evidence summarization, and strict technical evaluation are merged. The capture path waits for settled page state and records route/profile/detail-ID manifest data, overflow diagnostics, console errors, page errors, and HTTP error responses. The analyzer writes machine-readable JSON and human-readable Markdown summaries, requires exact expected route/profile capture coverage, rejects missing, duplicate, and unexpected diagnostic records, classifies page-level horizontal overflow separately from nested overflow review candidates, and fails the audit after writing evidence when strict technical checks do not pass. Human screenshot review remains required even when technical evaluation passes.

The production screenshot-audit and unimpairment candidate-review workflows share a fail-closed actual D1 headroom check. After collector preflight and before Playwright installation, page traversal, or candidate-list discovery, the workflow queries current UTC-day D1 analytics, records a public-safe usage summary, and requires both rows-read and rows-written fractions to remain below the existing `0.8` threshold. Manual confirmation remains an operator-intent gate but no longer substitutes for measured usage.

A bounded one-shot 2026-07-08 UTC operation is scheduled in the active path: the M1 exit review at 00:10 UTC with readiness enforcement enabled for the scheduled run, followed by the production UI audit at 00:30 UTC. The M1 review preserves its evidence artifact even when strict readiness is not yet satisfied. The UI audit independently rechecks collector health and actual D1 headroom before any Playwright installation or page crawl. Candidate review is not scheduled because natural unimpairment evidence is already observed and consistent. Both schedules are date-guarded so later annual cron matches no-op outside the explicit 2026-07-08 UTC window.

Route-aware SEO/discoverability preparation is implemented. Canonical and structured-data output remain inactive until an explicit public-site origin is configured, sitemap output is generated only when the final public origin is configured, and GA4 remains inactive until a valid measurement ID is supplied.

M5-5 and M6 remain gated behind M1 exit.

## Latest resource evidence

The 2026-07-07 21:09 UTC audit-headroom retry probe recorded:

- rows read: `10,590,963`;
- rows written: `241,785`;
- reference allowances: `5,000,000` rows read and `100,000` rows written per UTC day;
- measured headroom gate: failed.

The gate correctly stopped candidate discovery. Production screenshot crawl remains deferred until a new UTC-day measurement passes both read and write thresholds. Candidate review is no longer active while natural unimpairment evidence remains valid and consistent. The UI gate remains unchanged and is not bypassed by the scheduled operation.

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

## Latest M1 gates

- `verifiedBaseBinding`: observed;
- `catchUpStart`: observed;
- `validatedHeadReached`: missing at the 2026-07-07 21:08 UTC probe because cursor `3472761` had not yet reached observed head `3472781`;
- `liveContinuation`: observed;
- overall M1 readiness: false at that probe.

## M1 exit review

The `.github/workflows/m1-exit-review.yml` workflow captures a reproducible read-only evidence package. Manual dispatch retains the existing optional `require_ready` input. The date-guarded scheduled run enforces readiness. Readiness enforcement requires every HYB-7 path and M1 gate to be observed, collector lag equal to zero, zero consecutive failures, and expected replacement-base, hybrid-history, Overview, and exact current-state bindings.

The latest semantic probe is sufficient to retire the unimpairment witness gap, but it is not itself an M1 exit. The one-shot scheduled review must prove strict fresh-head arrival and all remaining readiness conditions in one reproducible exit artifact or fail closed while retaining the artifact.

## Active unit

The active work is split into permanent monitoring plus two coordinated tracks.

### Permanent monitoring

1. Maintain the 30-minute lightweight runtime monitor.
2. Maintain the guarded 6-hour deep semantic diagnostics.
3. Preserve source identity, cursor/overlay agreement, zero-failure operation, and actual D1 usage visibility.
4. Do not retune collector limits or weaken D1 guards without measured evidence.

### Track A — M1 completion

1. Preserve the newly observed natural unimpairment and passing HYB-7 continuation evidence.
2. Do not run candidate discovery or the external witness procedure while the natural evidence remains valid and consistent.
3. Let the scheduled 00:10 UTC M1 exit review recheck strict head arrival with readiness enforcement.
4. If every M1 gate is observed, retain the successful exit artifact and reconcile repository status before M5-5.
5. If strict readiness is still missing, retain the failed review artifact, keep permanent monitoring active, and repeat only from later evidence without weakening the gate.

### Track B — production UI audit

1. Let the scheduled 00:30 UTC production audit attempt proceed only when measured headroom and healthy zero-lag collector preflight both pass.
2. Inspect the generated JSON/Markdown technical summary, raw manifest and diagnostics, and screenshots together; technical evaluation accelerates and enforces triage but does not replace human visual review.
3. Remediate confirmed UI defects and re-audit affected routes.

Tracks A and B may progress in parallel. Neither may weaken collector integrity or D1 resource guards.

## Next order

1. Keep permanent monitoring active.
2. Observe the 2026-07-08 00:10 UTC readiness-enforced M1 exit review.
3. If M1 exits, reconcile roadmap/status from the artifact and proceed to M5-5; otherwise retain the artifact and continue strict head monitoring.
4. Observe the independently gated 00:30 UTC production UI audit attempt.
5. If the UI gate passes, inspect summaries, raw diagnostics, and screenshots, fix confirmed UI defects, and re-audit affected routes; if it fails, retain measured evidence and do not weaken the gate.
6. Complete M5-5 real-data integration, bounded live exports, browser regression, current/history consistency, lifecycle/current-object consistency, archive/current exclusion, and bounded production behavior smoke after M1 exit.
7. Complete M6 integrity/reset simulations, runtime/resource guardrails, final visual audit, accessibility, performance, security, and cross-browser validation.
8. Bind SEO/discoverability to the final public host and complete owner-managed analytics and search setup.
9. Finalize operations/deployment documentation and recovery verification.
10. Complete the real multi-day Devnet soak and final release verification.

## Remaining blockers

- M1 exit remains incomplete until a later strict fresh-head check observes `validatedHeadReached` and the reproducible readiness-enforced exit review passes.
- M5-5 real-data integration remains gated behind M1 exit.
- The latest 2026-07-07 21:09 UTC measured headroom probe failed the threshold. Production screenshot audit remains deferred until a new current-day measurement passes; scheduling cannot bypass it.
- Production behavior smoke remains pending for the post-M1 M5-5 path.
- Final-host SEO binding and M6 release hardening remain pending in roadmap order.
