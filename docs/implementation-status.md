# Implementation status

Last updated: 2026-07-07.

## Current phase

The canonical-history and replacement-base cutover has completed on XRPL Devnet. Production history runs in verified hybrid mode: immutable canonical history covers ledgers `3371676..3432924`, and D1 live continuation covers the boundary after ledger `3432924`. The canonical chain contains `61,249` ledgers in `123` immutable segments and is published through the exact-commit history channel with an exact index containing `280,454` records.

The active current-state base is `devnet-3432924-canonical` at ledger `3432924`. The guarded replacement-base rebase completed successfully, the D1 cursor and replacement overlay watermark are aligned, and scheduled collection resumed from ledger `3432925`. Production current-state exact reads for a verified Vault, Loan Broker, and Loan return HTTP 200 from the replacement snapshot.

Post-cutover monitoring is now split into a lightweight 30-minute runtime monitor and guarded deep diagnostics every 6 hours. Deep diagnostics are deferred once current UTC-day D1 rows-read usage reaches the configured `4,000,000` guard unless explicitly forced by manual dispatch.

The latest bounded runtime probe captured at 2026-07-07 11:44 UTC shows continued collector progress with zero consecutive failures, no current error, cursor `3461324`, observed head `3461639`, and lag `315`. The processed continuation range is contiguous from `3432925` through `3461324` with zero discontinuities. HYB-7 now observes created current objects, modified current objects, LoanPay/payment, default, deletion/archive handling, activity/history/balance consistency, ledger continuity, and cursor/overlay agreement. Remaining missing paths are impairment, unimpairment, and freshness at a healthy zero-lag head.

The current-state relationship-list amplification issue has been repaired, and the mobile More menu now exposes an explicit visible close control in addition to route-change and toggle closure. The separate public history-read investigation proved the immutable source itself was valid; sparse bounded scans were repaired by skipping published zero-record kinds, accepting complete merged newest-first windows, and applying bounded kind-specific scan ceilings for sparse archive and balance history. Final production probes returned HTTP 200 for Activity, Lifecycle, Archived Objects, and Cover & Loss at limits `25`, `50`, `75`, and `100`.

M5-5 and M6 remain gated behind M1 exit.

## Canonical history and replacement base

The production immutable history range is fixed to:

- epoch: `devnet-3371675`;
- start ledger: `3371676`;
- end ledger: `3432924`;
- ledger count: `61,249`;
- segment count: `123`;
- terminal ledger hash: `52C13CBFFC3433750DBBB986390C4C6E6F7CC82CF70B4B909C506536A8BD9218`.

The active replacement current-state base is:

- epoch: `devnet-3371675`;
- snapshot: `devnet-3432924-canonical`;
- ledger index: `3432924`;
- ledger hash: `52C13CBFFC3433750DBBB986390C4C6E6F7CC82CF70B4B909C506536A8BD9218`.

The previous verified base remains retained as historical architecture evidence:

- snapshot: `devnet-3371675-0ba2ed766c19`;
- ledger index: `3371675`;
- ledger hash: `0BA2ED766C190C733F8F26288785CBDF01D0FC26E1A6C03EDB7E9DFF6F8BCB90`;
- 797,550 Vault records;
- 528,228 Loan Broker records;
- 226,725 Loan records;
- 1,552,503 total current-state records.

## Completed path

The implemented and verified path now includes:

- verified immutable base publication and lightweight current-state reading;
- bounded D1 incremental history and current overlay;
- atomic history, overlay, watermark, and cursor advancement;
- base-plus-overlay current API resolution;
- bounded scheduled collection with RPC, transaction, row, statement, overlay, and execution-time ceilings;
- retry and fallback request accounting;
- collector cursor, lag, freshness, and run-usage status;
- guarded initial handover from the observation epoch to the original verified base;
- deterministic immutable history-segment generation and replay;
- exact adjacent-segment index and parent-hash continuity checks;
- checkpoint/resume state advancing only after complete validated manifests;
- ordered full-chain verification;
- canonical publication binding exact chain boundaries, ordered segment identities, manifest digests, predecessor linkage, and per-kind counts;
- exact-commit channel opening that pins publication, manifests, segment assets, and exact index to one immutable data commit;
- bounded immutable segment reads;
- boundary-aware D1 history reads;
- deterministic immutable-plus-live merge semantics with overlap suppression, deduplication, stable ordering, and post-merge truncation;
- hybrid Activity, Object History, Loan lifecycle, Archives, Balance History, Transaction Detail, and cross-history Search support;
- exact-index manifest binding and exact-term bucket routing;
- exact-index extraction for transaction hashes, object IDs, relationships, accounts, owners, borrowers, asset keys, lifecycle terms, and balance-history terms;
- canonical full-chain generation for `3371676..3432924`;
- successful verification of all `123` segments and the exact terminal boundary;
- canonical publication and exact index generation;
- exact lookup rehearsal against the published full chain;
- replacement current-state read-model reconstruction at ledger `3432924`;
- separate history and current-state candidate publication;
- production-reader remote candidate rehearsal for boundary identity, current-state list/exact reads, exact history references, and recent immutable history reads;
- guarded same-epoch replacement-base rebase planning and execution;
- pre/post sync, overlay, and epoch guards around the replacement rebase batch;
- read-only production D1 dry-run proving the live rebase plan was ready before activation;
- replacement rebase execution from cursor `3390079` to base ledger `3432924`;
- D1 continuation from ledger `3432925` onward;
- idempotent replacement-base replay semantics after the live cursor advances beyond the replacement target;
- production hybrid history activation;
- production replacement current-state promotion;
- successful post-cutover production exact reads for Vault, Loan Broker, and Loan;
- boundary-aware HYB-7 evidence and drilldown after the active replacement base;
- boundary-aware M1 exit evidence using the replacement target as authoritative expected base;
- permanent read-only runtime monitoring and explicit history-source diagnostics;
- D1-safe monitoring cadence separation and a read-budget guard for deep diagnostics;
- indexed HYB-7 overlay/object-change source matching to remove the observed high-read correlated lookup;
- reproducible manual M1 exit review workflow capturing runtime gates, source invariants, and current-state exact-read evidence;
- production-shaped current-state list probing and repaired UI-sized relationship reads;
- verified hybrid public history reads across Activity, Lifecycle, Archived Objects, and Cover & Loss at UI-sized windows through limit 100;
- sparse immutable history scan handling that skips published zero-record kinds and uses bounded kind-specific ceilings where required;
- explicit mobile More menu close control with route-change closure preserved.

Mainnet remains disabled.

## Latest live evidence

The latest recorded post-cutover evidence in `docs/evidence/d1-safe-post-cutover-runtime-20260707.json` observed:

- first cursor: `3438844`;
- last cursor: `3438924`;
- cursor delta: `+80`;
- first validated head: `3450288`;
- last validated head: `3450347`;
- head delta: `+59`;
- first lag: `11,444` ledgers;
- last lag: `11,403` ledgers;
- lag delta: `-41`;
- samples: `3`;
- samples with failures: `0`;
- final run ledgers processed: `40`;
- final run RPC requests: `40`;
- final run estimated rows: `81`;
- final run estimated statements: `80`;
- final run overlay mutations: `2`;
- final run duration: `8,262 ms`.

The same evidence recorded UTC-day D1 usage at that observation point:

- rows read: `4,507,979` against the `5,000,000` daily allowance reference used by operations monitoring;
- rows written: `32,516` against the `100,000` daily allowance reference used by operations monitoring.

The dominant prior read-amplification issue was traced to the HYB-7 overlay/object-change source-match query omitting canonical `object_type` from correlated lookups. The corrected query binds canonical object type and object ID so the existing object-history index can serve the lookup. The old hot query was absent from the recent post-fix top-read list; the largest remaining observed deep query was approximately `25,926` rows read per run.

The latest known HYB-7 states are:

- `createdCurrent`: observed;
- `modifiedCurrent`: observed;
- `deletionArchive`: observed;
- `ledgerContinuity`: observed;
- `cursorOverlay`: observed;
- `loanPayment`: observed;
- `defaulted`: observed;
- `activityHistoryBalance`: observed;
- `impaired`: missing;
- `unimpaired`: missing;
- `freshness`: missing while the collector remains behind the observed validated head.

The latest known M1 gates are:

- `verifiedBaseBinding`: observed;
- `catchUpStart`: observed;
- `validatedHeadReached`: missing;
- `liveContinuation`: missing because all required HYB-7 live paths are not yet observed.

## Collector budgets

Production continuation uses:

- max ledgers per run: 40;
- max statements per run: 2048;
- max rows per run: 2048;
- max overlay mutations per run: 128;
- max ledger RPC requests per run: 44;
- max inspected transactions per run: 12,000;
- execution budget: 45 seconds;
- deadline margin: 5 seconds.

These are ceilings, not write targets. Runtime monitoring continues to observe actual D1 read/write usage, collector failures, overlay mutation volume, and lag slope.

## HYB-7 verification semantics

The verifier exposes each required live path as `observed`, `missing`, or `inconsistent`.

- zero required evidence remains `missing` and never passes by default;
- contradictory source/projection evidence is `inconsistent`;
- the overall report passes only when every required path is `observed`;
- processed-ledger continuity begins at the active replacement base boundary and validates parent-hash linkage from that anchor;
- object changes, protocol activity, lifecycle, archives, balance history, managed transitions, loan activity, and drilldown linkage are evaluated only after the active base boundary;
- archive and tombstone evidence is checked in both directions;
- cursor and overlay watermark must agree;
- freshness passes only at healthy zero reported lag.

The verification and diagnostics endpoints are read-only. They do not create live evidence or infer success from the target schedule.

## M1 exit review operation

The manual `.github/workflows/m1-exit-review.yml` workflow captures a reproducible read-only evidence package for M1 exit review.

With `require_ready=false`, it captures evidence and fails on contradictions, source identity drift, current-state sample read failures, or collector failure state without claiming M1 completion.

With `require_ready=true`, it additionally requires:

- HYB-7 `passed == true` and every HYB-7 path `observed`;
- M1 `ready == true` and every M1 gate `observed`;
- collector lag equal to zero;
- zero consecutive collector failures;
- replacement-base, hybrid-history, Overview, and current Vault/Broker/Loan exact reads bound to the expected active sources.

See `docs/operations-m1-exit-review.md` for the operation and evidence interpretation rules.

## Active unit

The active implementation unit is no longer historical backfill or cutover construction. Canonical immutable history, exact index, hybrid history activation, replacement current-state reconstruction, guarded D1 rebase, and production current-state promotion are complete.

The active operational unit is now:

1. continue bounded D1 collection unchanged from `3432925` toward the observed validated head;
2. verify sustained zero-failure operation and actual D1 resource usage under the documented ceilings;
3. observe real post-boundary impairment and unimpairment evidence;
4. confirm `validatedHeadReached` and freshness at healthy zero lag;
5. run the M1 exit review workflow with `require_ready=true` and retain the evidence artifact;
6. update repository status from the successful exit evidence;
7. proceed to M5-5 real-data integration;
8. run the production full-page desktop/mobile screenshot audit, remediate UI overflow and spacing defects, and re-audit;
9. complete SEO/discoverability implementation and final-host binding, then owner-managed subdomain, analytics, Search Console verification, and sitemap submission;
10. proceed through M6 hardening and real multi-day Devnet soak.

Non-invasive parallel preparation is allowed while M1 catch-up continues. The gated manual screenshot workflow is prepared: it discovers valid detail IDs through read-only APIs, captures the representative desktop/mobile route matrix plus the open mobile More menu, and refuses to run unless fresh-head and D1-headroom confirmations are supplied; it also verifies collector healthy zero-lag state before crawling. Route-aware SEO metadata is also prepared for the implemented HTML route surface, volatile detail routes and unknown routes fail closed for indexing, canonical and structured-data output remains inactive until an explicit public-site origin is configured, robots output is always generated, sitemap output is generated only when the final public origin is configured, and GA4 remains inactive until a valid measurement ID is supplied. The production screenshot crawl, final-host binding, analytics configuration, Search Console verification, and sitemap submission remain pending. These preparation tasks do not justify slowing, resetting, rebasing, or retuning the collector.

## Next order

1. Monitor collector lag slope and D1 usage while continuation advances without changing collector limits absent failure or resource evidence.
2. Keep replacement-base replay status, cursor/overlay agreement, and history-source diagnostics under permanent monitoring.
3. Re-evaluate impairment and unimpairment evidence while the collector reaches the observed validated head.
4. Confirm freshness at healthy zero lag and re-run continuation plus M1 diagnostics.
5. Execute the reproducible M1 exit review with readiness enforcement.
6. Complete M1 status review and M5-5 real-data integration.
7. Run the representative production screenshot audit, complete UI remediation, and re-audit.
8. Finalize SEO/discoverability against the configured public host and complete owner-managed subdomain, analytics, Search Console, and sitemap tasks.
9. Complete M6 hardening and real multi-day Devnet soak.

## Remaining blockers

- The production cursor has not yet reached the observed validated head.
- Real post-replacement-boundary HYB-7 evidence remains missing for impairment and unimpairment.
- Freshness remains missing until collector lag reaches zero with healthy status.
- M1 exit remains incomplete until `validatedHeadReached` and all required live continuation paths are observed and consistent.
- M5-5 real-data integration remains gated behind M1 exit.
- Production visual audit, final-host SEO binding, and M6 release hardening remain pending in the dependency order defined by the roadmap.
