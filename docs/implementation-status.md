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

Route-aware SEO/discoverability preparation is implemented. Canonical and structured-data output remain inactive until an explicit public-site origin is configured, sitemap output is generated only for that configured origin, and GA4 remains inactive until a valid measurement ID is supplied.

M5-5 and M6 remain gated behind M1 exit.

## Latest resource evidence

The 2026-07-07 21:09 UTC audit-headroom retry probe recorded:

- rows read: `10,590,963`;
- rows written: `241,785`;
- reference allowances: `5,000,000` rows read and `100,000` rows written per UTC day;
- measured headroom gate: failed.

The gate correctly stopped candidate discovery. Production screenshot crawl and candidate review remain deferred until a new UTC-day measurement passes both read and write thresholds. The gate remains unchanged and is not bypassed by the newly observed natural unimpairment evidence.

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

The manual `.github/workflows/m1-exit-review.yml` captures a reproducible read-only evidence package. With `require_ready=true`, it requires every HYB-7 path and M1 gate to be observed, collector lag equal to zero, zero consecutive failures, and expected replacement-base, hybrid-history, Overview, and exact current-state bindings.

The latest semantic probe is sufficient to retire the unimpairment witness gap, but it is not itself an M1 exit. A later review must prove strict fresh-head arrival and all remaining readiness conditions in one reproducible exit artifact.

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
3. Obtain a later strict fresh-head M1 diagnostic state with `validatedHeadReached: observed`.
4. Run M1 exit review with `require_ready=true` only when every M1 gate is observed, and retain the artifact.
5. Reconcile repository status and proceed to M5-5 only after successful M1 exit.

### Track B — production UI audit

1. After UTC-day reset or another safe point, dispatch the audit workflow and let its actual D1 usage check decide eligibility.
2. Proceed with the screenshot crawl only when measured headroom and healthy zero-lag collector preflight both pass.
3. Inspect the generated JSON/Markdown technical summary, raw manifest and diagnostics, and screenshots together; technical evaluation accelerates and enforces triage but does not replace human visual review.
4. Remediate confirmed UI defects and re-audit affected routes.

Tracks A and B may progress in parallel. Neither may weaken collector integrity or D1 resource guards.

## Next order

1. Keep permanent monitoring active.
2. Recheck strict M1 head arrival after the collector advances beyond the 20-ledger gap recorded at 21:08 UTC; do not infer `validatedHeadReached` from the public lag field alone.
3. When every M1 gate is observed, execute M1 exit review with readiness enforcement and reconcile status from the artifact.
4. After UTC-day reset or another safe point, dispatch the self-enforcing D1 headroom checks for production screenshot audit; candidate review is unnecessary while natural unimpairment evidence remains valid.
5. Only when the measured gate passes, perform the screenshot crawl, inspect generated summaries, raw diagnostics, and screenshots, fix confirmed UI defects, and re-audit affected routes.
6. Complete M5-5 real-data integration, bounded live exports, browser regression, current/history consistency, lifecycle/current-object consistency, archive/current exclusion, and bounded production behavior smoke.
7. Complete M6 integrity/reset simulations, runtime/resource guardrails, final visual audit, accessibility, performance, security, and cross-browser validation.
8. Bind SEO/discoverability to the final public host and complete owner-managed analytics and search setup.
9. Finalize operations/deployment documentation and recovery verification.
10. Complete the real multi-day Devnet soak and final release verification.

## Remaining blockers

- M1 exit remains incomplete until a later strict fresh-head check observes `validatedHeadReached` and the reproducible `require_ready=true` exit review passes.
- M5-5 real-data integration remains gated behind M1 exit.
- The latest 2026-07-07 21:09 UTC measured headroom probe failed the threshold. Production screenshot audit remains deferred until a new current-day measurement passes; manual confirmation cannot bypass it.
- Production behavior smoke remains pending for the post-M1 M5-5 path.
- Final-host SEO binding and M6 release hardening remain pending in roadmap order.
