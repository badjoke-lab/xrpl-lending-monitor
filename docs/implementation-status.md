# Implementation status

Last updated: 2026-07-07.

## Current phase

The canonical-history and replacement-base cutover has completed on XRPL Devnet. Production history runs in verified hybrid mode: immutable canonical history covers ledgers `3371676..3432924`, and D1 live continuation covers the boundary after ledger `3432924`. The canonical chain contains `61,249` ledgers in `123` immutable segments and is published through the exact-commit history channel with an exact index containing `280,454` records.

The active current-state base is `devnet-3432924-canonical` at ledger `3432924`. The guarded replacement-base rebase completed successfully, the D1 cursor and replacement overlay watermark are aligned, and scheduled collection resumed from ledger `3432925`. Production current-state exact reads for a verified Vault, Loan Broker, and Loan return HTTP 200 from the replacement snapshot.

Post-cutover monitoring is permanent and remains active after head arrival. It is split into a lightweight 30-minute runtime monitor and guarded deep semantic diagnostics every 6 hours. Deep diagnostics are deferred once current UTC-day D1 rows-read usage reaches the configured `4,000,000` guard unless explicitly forced by manual dispatch.

The latest bounded runtime probe captured at 2026-07-07 13:00 UTC shows a healthy collector at zero reported lag with zero consecutive failures and no current error. Cursor and observed head both equal `3463095`. The processed continuation range is contiguous from `3432925` through `3463095`, covering `30171` ledgers with zero discontinuities.

HYB-7 observes created current objects, modified current objects, LoanPay/payment, impairment, default, deletion/archive handling, activity/history/balance consistency, ledger continuity, cursor/overlay agreement, and freshness. Only unimpairment remains missing. The M1 `validatedHeadReached` gate is observed. `liveContinuation` remains missing only because the required unimpairment path has not yet been observed.

The production screenshot-audit workflow and capture hardening are merged. The capture path waits for visible main content, completed loading states, best-effort network idle, and web-font readiness. It records route/profile/detail-ID manifest data plus horizontal-overflow candidates, console errors, page errors, and HTTP error responses. The next production crawl remains gated by fresh-head preflight and the existing D1 headroom policy.

Route-aware SEO/discoverability preparation is implemented. Volatile detail routes and unknown routes fail closed for indexing. Canonical and structured-data output remain inactive until an explicit public-site origin is configured. Robots output is generated, sitemap output is generated only when the final public origin is configured, and GA4 remains inactive until a valid measurement ID is supplied.

M5-5 and M6 remain gated behind M1 exit.

## Canonical history and replacement base

Production immutable history:

- epoch: `devnet-3371675`;
- start ledger: `3371676`;
- end ledger: `3432924`;
- ledger count: `61,249`;
- segment count: `123`;
- terminal ledger hash: `52C13CBFFC3433750DBBB986390C4C6E6F7CC82CF70B4B909C506536A8BD9218`.

Active replacement current-state base:

- epoch: `devnet-3371675`;
- snapshot: `devnet-3432924-canonical`;
- ledger index: `3432924`;
- ledger hash: `52C13CBFFC3433750DBBB986390C4C6E6F7CC82CF70B4B909C506536A8BD9218`.

The previous verified base remains retained as historical architecture evidence.

## Completed path

The implemented and verified path includes:

- verified immutable base publication and lightweight current-state reading;
- bounded D1 incremental history and current overlay;
- atomic history, overlay, watermark, and cursor advancement;
- base-plus-overlay current API resolution;
- bounded scheduled collection with explicit runtime and resource ceilings;
- deterministic immutable history generation, publication, exact indexing, and full-chain verification;
- boundary-aware immutable-plus-D1 history reads and deterministic merge semantics;
- hybrid Activity, Object History, lifecycle, Archives, Balance History, Transaction Detail, and cross-history Search support;
- replacement current-state reconstruction, guarded same-epoch rebase, hybrid history activation, and current-state promotion;
- boundary-aware HYB-7 evidence and reproducible M1 exit review;
- permanent read-only runtime monitoring with D1-safe cadence separation;
- repaired relationship-list amplification and sparse immutable history scans;
- verified production history reads for Activity, Lifecycle, Archived Objects, and Cover & Loss through UI-sized windows up to limit 100;
- explicit mobile More menu close control;
- route-aware SEO/discoverability preparation;
- gated read-only unimpairment candidate review;
- bounded external Devnet unimpairment witness operation specification;
- hardened production UI-audit capture with settled-page waiting, manifest output, overflow diagnostics, and browser/runtime/HTTP error capture.

Mainnet remains disabled.

## Latest live evidence

The earlier evidence file `docs/evidence/d1-safe-post-cutover-runtime-20260707.json` records catch-up progress before head arrival. The newer bounded 2026-07-07 13:00 UTC operational probe supersedes that earlier position for current head state:

- collector: healthy;
- cursor: `3463095`;
- observed head: `3463095`;
- lag: `0`;
- consecutive failures: `0`;
- current error: `null`;
- continuation range: `3432925..3463095`;
- processed ledgers: `30171`;
- discontinuities: `0`.

The 2026-07-07 13:13 UTC production-audit headroom probe recorded:

- rows read: `9,761,975`;
- rows written: `181,117`;
- operations-monitor reference allowances: `5,000,000` rows read and `100,000` rows written per UTC day.

The existing below-80% audit headroom gate correctly stopped the screenshot crawl before Playwright installation or page traversal. The gate must not be weakened; retry only after a new UTC-day usage check confirms headroom.

Latest HYB-7 states:

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

Latest M1 gates:

- `verifiedBaseBinding`: observed;
- `catchUpStart`: observed;
- `validatedHeadReached`: observed;
- `liveContinuation`: missing only because the required unimpairment path has not yet been observed.

## HYB-7 verification semantics

The verifier exposes each required live path as `observed`, `missing`, or `inconsistent`.

- zero required evidence remains `missing` and never passes by default;
- contradictory source/projection evidence is `inconsistent`;
- the overall report passes only when every required path is `observed`;
- processed-ledger continuity begins at the active replacement-base boundary;
- source and projection evidence is evaluated only after the active base boundary;
- archive and tombstone evidence is checked in both directions;
- cursor and overlay watermark must agree;
- freshness passes only at healthy zero reported lag.

The verification and diagnostics endpoints are read-only. They do not create live evidence or infer success from the target schedule.

## M1 exit review operation

The manual `.github/workflows/m1-exit-review.yml` workflow captures a reproducible read-only evidence package for M1 exit review.

With `require_ready=true`, it requires:

- HYB-7 `passed == true` and every HYB-7 path `observed`;
- M1 `ready == true` and every M1 gate `observed`;
- collector lag equal to zero;
- zero consecutive collector failures;
- replacement-base, hybrid-history, Overview, and current Vault/Broker/Loan exact reads bound to the expected active sources.

See `docs/operations-m1-exit-review.md` for the operation and evidence interpretation rules.

## Active unit

The active implementation unit is no longer historical backfill or cutover construction. Canonical immutable history, exact index, hybrid history activation, replacement current-state reconstruction, guarded D1 rebase, production current-state promotion, fresh-head catch-up, and screenshot-audit capture hardening are complete.

Work is split into permanent monitoring plus two coordinated tracks.

### Permanent monitoring

1. Maintain the 30-minute lightweight runtime monitor.
2. Maintain the guarded 6-hour deep semantic diagnostics.
3. Preserve replacement-base replay status, cursor/overlay agreement, history-source invariants, zero-failure operation, and actual D1 usage visibility.
4. Do not retune collector limits or weaken D1 guards without measured failure or resource evidence.

### Track A — M1 completion

1. Resolve the single remaining HYB-7 evidence gap: real post-boundary unimpairment.
2. Run the gated manual read-only candidate review only when D1 headroom permits.
3. Prefer naturally observed Devnet evidence.
4. If natural evidence remains absent, use only the separately approved documented external Devnet witness procedure.
5. Require source, lifecycle, current-state, loss/balance-history, continuity, overlay, and freshness agreement before marking unimpairment observed.
6. Run M1 exit review with `require_ready=true` and retain the artifact.
7. Reconcile repository status and proceed to M5-5 only after successful M1 exit.

### Track B — production UI audit

1. Re-check D1 usage after UTC-day reset or another safe point.
2. Run the gated production screenshot audit only when the existing headroom policy passes and collector healthy zero-lag preflight passes.
3. Inspect screenshots together with route/profile/detail-ID manifest, horizontal overflow diagnostics, overflowing-element candidates, console errors, page errors, and HTTP error responses.
4. Remediate confirmed UI defects and re-audit affected routes.

Tracks A and B may progress in parallel. Neither may weaken collector integrity or D1 resource guards.

## Next order

1. Keep permanent lightweight and deep monitoring active.
2. Re-check D1 headroom after UTC-day usage reset or another safe point.
3. When headroom passes, run the read-only unimpairment candidate review and the gated representative production screenshot audit.
4. Inspect screenshot and technical diagnostic evidence, fix confirmed UI defects, and re-audit affected routes.
5. Resolve the sole unimpairment witness gap through real Devnet evidence, preferring natural evidence and using the documented external Devnet witness procedure only if required.
6. Execute M1 exit review with readiness enforcement and reconcile status from the successful artifact.
7. Complete M5-5 cross-audit real-data integration, bounded live exports, real-data browser regression, current/history consistency, lifecycle/current-object consistency, archive/current exclusion, and bounded production behavior smoke.
8. Complete M6 integrity/reset simulations, runtime/resource guardrails, final post-integration visual audit, accessibility, performance, security, and cross-browser validation.
9. Bind SEO/discoverability to the final public host, then complete owner-managed subdomain, valid analytics configuration, Search Console verification, and sitemap submission.
10. Finalize operations/deployment documentation and backup/export recovery verification.
11. Complete the real multi-day Devnet soak and final release verification.

## Remaining blockers

- Real post-replacement-boundary HYB-7 evidence remains missing only for unimpairment.
- M1 exit remains incomplete until that unimpairment path is observed and `liveContinuation` becomes observed.
- M5-5 real-data integration remains gated behind M1 exit.
- The production visual-audit fresh-head gate is satisfied, but the 2026-07-07 13:13 UTC headroom probe exceeded the operations threshold. Retry only after a new UTC-day usage check confirms headroom; do not weaken the gate.
- Production behavior smoke is specified for the post-M1 M5-5 real-data integration path and remains pending.
- Final-host SEO binding and M6 release hardening remain pending in the dependency order defined by the roadmap.
