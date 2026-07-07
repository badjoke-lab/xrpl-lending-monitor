# Implementation status

Last updated: 2026-07-08.

## Current phase

The canonical-history and replacement-base cutover is complete on XRPL Devnet. Production history runs in verified hybrid mode: immutable canonical history covers ledgers `3371676..3432924`, and D1 live continuation covers the boundary after ledger `3432924`. The active current-state base is `devnet-3432924-canonical` at ledger `3432924`.

Post-cutover monitoring remains permanent: a lightweight runtime monitor runs every 30 minutes and guarded deep semantic diagnostics run every 6 hours. Deep diagnostics respect the existing D1 read guard.

The latest bounded runtime probe captured at 2026-07-07 13:00 UTC showed:

- collector healthy;
- cursor and observed head `3463095`;
- lag `0`;
- consecutive failures `0`;
- current error `null`;
- contiguous continuation `3432925..3463095`;
- `30171` processed ledgers;
- `0` discontinuities.

HYB-7 observes created current objects, modified current objects, LoanPay/payment, impairment, default, deletion/archive handling, activity/history/balance consistency, ledger continuity, cursor/overlay agreement, and freshness. Only unimpairment remains missing. M1 `validatedHeadReached` is observed, while `liveContinuation` remains missing only because unimpairment has not yet been observed.

The production screenshot-audit workflow and capture hardening are merged. The capture path waits for settled page state and records route/profile/detail-ID manifest data, overflow diagnostics, console errors, page errors, and HTTP error responses. The workflow now also analyzes the captured manifest and diagnostics into machine-readable and Markdown summaries while retaining explicit human visual review as a separate requirement.

The production screenshot-audit and unimpairment candidate-review workflows share a fail-closed actual D1 headroom check. After collector preflight and before Playwright installation, page traversal, or candidate-list discovery, each workflow queries current UTC-day D1 analytics, records a public-safe usage summary, and requires both rows-read and rows-written fractions to remain below the existing `0.8` threshold. Manual confirmation remains an operator-intent gate but does not substitute for measured usage.

A bounded one-shot post-reset attempt is scheduled for 2026-07-08 UTC: read-only unimpairment candidate review at 00:10 UTC, followed by production UI audit at 00:30 UTC. Both scheduled paths remain subject to healthy zero-lag collector preflight and the same measured below-80% D1 headroom gate. The UI attempt therefore measures headroom after the earlier bounded candidate-review attempt. The schedule is year-guarded so later annual cron matches no-op unless explicitly changed.

Route-aware SEO/discoverability preparation is implemented. Canonical and structured-data output remain inactive until an explicit public-site origin is configured, sitemap output is generated only for that configured origin, and GA4 remains inactive until a valid measurement ID is supplied.

M5-5 and M6 remain gated behind M1 exit.

## Latest resource evidence

The 2026-07-07 13:13 UTC production-audit headroom probe recorded:

- rows read: `9,761,975`;
- rows written: `181,117`;
- reference allowances: `5,000,000` rows read and `100,000` rows written per UTC day.

The below-80% gate correctly stopped the screenshot crawl before Playwright installation or page traversal. The gate remains unchanged. The scheduled post-reset attempts must obtain new current-day measurements and pass both read and write thresholds before their bounded reads proceed.

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
- `unimpaired`: missing;
- `freshness`: observed.

## Latest M1 gates

- `verifiedBaseBinding`: observed;
- `catchUpStart`: observed;
- `validatedHeadReached`: observed;
- `liveContinuation`: missing only because the required unimpairment path has not yet been observed.

## M1 exit review

The manual `.github/workflows/m1-exit-review.yml` captures a reproducible read-only evidence package. With `require_ready=true`, it requires every HYB-7 path and M1 gate to be observed, collector lag `0`, zero consecutive failures, and expected replacement-base, hybrid-history, Overview, and exact current-state bindings.

## Active unit

The active work is split into permanent monitoring plus two coordinated tracks.

### Permanent monitoring

1. Maintain the 30-minute lightweight runtime monitor.
2. Maintain the guarded 6-hour deep semantic diagnostics.
3. Preserve source identity, cursor/overlay agreement, zero-failure operation, and actual D1 usage visibility.
4. Do not retune collector limits or weaken D1 guards without measured evidence.

### Track A — M1 completion

1. Resolve the single remaining HYB-7 evidence gap: real post-boundary unimpairment.
2. Let the scheduled bounded read-only candidate-review attempt run only if its measured actual D1 headroom gate passes.
3. Prefer naturally observed Devnet evidence.
4. Use the separately approved documented external Devnet witness procedure only when required.
5. Require source, lifecycle, current-state, loss/balance-history, continuity, overlay, and freshness agreement before marking unimpairment observed.
6. Run M1 exit review with `require_ready=true` and retain the artifact.
7. Reconcile repository status and proceed to M5-5 only after successful M1 exit.

### Track B — production UI audit

1. Let the scheduled post-reset audit attempt proceed only when measured headroom and healthy zero-lag collector preflight both pass.
2. Inspect screenshots together with manifest, machine-readable analysis, Markdown summary, and technical diagnostics.
3. Remediate confirmed UI defects and re-audit affected routes.

Tracks A and B may progress in parallel. Neither may weaken collector integrity or D1 resource guards.

## Next order

1. Keep permanent monitoring active.
2. Observe the 2026-07-08 UTC one-shot candidate-review and production UI-audit attempts.
3. If the measured gates pass, inspect candidate and UI artifacts; if they do not pass, retain the measured evidence and do not weaken the gates.
4. Fix confirmed UI defects and re-audit affected routes.
5. Resolve the sole unimpairment witness gap through real Devnet evidence.
6. Execute M1 exit review with readiness enforcement and reconcile status from the artifact.
7. Complete M5-5 real-data integration, bounded live exports, browser regression, current/history consistency, lifecycle/current-object consistency, archive/current exclusion, and bounded production behavior smoke.
8. Complete M6 integrity/reset simulations, runtime/resource guardrails, final visual audit, accessibility, performance, security, and cross-browser validation.
9. Bind SEO/discoverability to the final public host and complete owner-managed analytics and search setup.
10. Finalize operations/deployment documentation and recovery verification.
11. Complete the real multi-day Devnet soak and final release verification.

## Remaining blockers

- Real post-replacement-boundary HYB-7 evidence remains missing only for unimpairment.
- M1 exit remains incomplete until unimpairment is observed and `liveContinuation` becomes observed.
- M5-5 real-data integration remains gated behind M1 exit.
- The last recorded headroom probe exceeded the threshold. The scheduled post-reset attempts must obtain and pass new measured current-day gates; scheduling does not bypass the policy.
- Production behavior smoke remains pending for the post-M1 M5-5 path.
- Final-host SEO binding and M6 release hardening remain pending in roadmap order.
