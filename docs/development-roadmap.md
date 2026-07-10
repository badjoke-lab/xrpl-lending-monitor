# Development roadmap

Baseline date: 2026-07-01.
Last recalibrated: 2026-07-08.

This document controls implementation order and dependencies. Dates are planning targets rather than promises. Correctness, data integrity, accessibility, and release evidence take priority over calendar targets.

The current M1 execution path is a verified immutable base read model plus bounded D1 incremental history and current-state overlay. The earlier D1-only full-snapshot plan is retained as architectural history in [`d1-migration-plan.md`](d1-migration-plan.md) but no longer controls active implementation order.

The approved product-evolution path is documented in [`observatory-roadmap.md`](observatory-roadmap.md): complete M5-5, establish early M6 integrity and resource guardrails, implement bounded Explorer v1, complete the remaining M6 release hardening and real soak, then proceed through XRPL Lending Observatory O1 data foundation, O2 monitoring view, and O3 Explorer v2. Explorer scope is defined in [`explorer-spec.md`](explorer-spec.md).

## Milestone summary

| Milestone | Status | Goal | Exit condition |
|---|---|---|---|
| M0 Foundation and specification lock | Complete | Establish repository, source-of-truth documents, toolchain, and operating rules | Documentation accepted and project skeleton ready |
| M1 Current-state collector | Complete | Serve a verified Devnet base state and continuously apply validated ledger changes | Verified base read model serves real Devnet data; contiguous scheduled collection remains healthy at a strict fresh head; required HYB-7 paths and M1 exit review pass |
| M2 Event history and lifecycle | Complete through Checkpoint B | Normalize validated history, lifecycle, archives, balances, and status | Deterministic replay and reconciliation logic complete; production completeness remains bounded by M1 continuation and later soak evidence |
| M3 Public API | Complete through exports and feeds; current merge integration pending final real-data cross-audit | Expose bounded read-only current and historical APIs | Base-plus-overlay current routes and historical contracts pass, with explicit freshness and unavailable states |
| M4 Baseline UI and project pages | Complete through Checkpoint C | Deliver the ordinary monitor, navigation, project pages, responsive behavior, and shared states | Required baseline routes work end to end; live freshness claims remain gated by verified runtime evidence |
| M5 Differentiated audit UI | M5-5 API cross-audit passed; browser regression and representative behavior smoke active | Add lifecycle, archives, cover/loss, epochs, provenance, and cross-audit integration | Audit integration and bounded production behavior smoke pass against verified real data after M1 exits |
| M6 Hardening and public Devnet release | Release-preparation implementation active; final hardening gated by M1 and M5-5 | Prove integrity and resource safety, add bounded Explorer v1, then complete accessibility, discoverability, operations, and deployment readiness | Explorer v1 passes resource and browser gates; final visual audit, production behavior smoke, SEO/discoverability, recovery verification, multi-day soak, and all release gates pass |
| O1 Observatory data foundation | Planned after stable Monitor release and real soak | Define bounded incremental historical metrics and reusable series | Approved metric contracts, replay safety, retention, resource evidence, API contracts, and reconciliation pass |
| O2 Observatory monitoring view | Planned after O1 | Establish technical monitoring interpretation of historical change and trends | Stable Observatory metrics are displayed consistently with bounded range, provenance, and production evidence |
| O3 Explorer v2 | Planned after O2 | Add guided historical and comparative exploration | Every visualization maps to stable Observatory contracts and passes resource, accessibility, and browser gates |

## Cross-cutting rules

- No page invents values to appear complete.
- Devnet and Mainnet data never mix.
- Mainnet, wallet, signing, transaction submission, funding, payments, pricing, fiat conversion, cross-asset totals, and proprietary risk scores remain outside scope.
- Generated mockups are visual references only.
- The public Worker uses one D1 binding, `DB`, for network state, cursors, normalized history, overlays, tombstones, aggregates, and operational state.
- Complete base read models are immutable, versioned, manifest verified, and replaced only through an explicit publication process.
- Incremental history and current-state overlay changes advance from the same validated-ledger cursor boundary.
- A D1 overlay upsert overrides the base object; a deletion tombstone hides the base object; absence of an overlay record falls back to the verified base.
- Gap, stale, partial, and unavailable states are explicit. A stale base plus interrupted incremental continuation is never presented as fresh.
- Internal account circumstances, credentials, provider identifiers, workflow run identifiers, and unpublished operational details remain outside public documentation.
- Collector monitoring continues after lag reaches zero. Collector limits or cadence are not retuned without failure, lag-slope, or resource evidence that justifies the change.
- Release-preparation work that does not mutate collector, D1, history, or deployment state may proceed in parallel, but gated production audits and public indexing configuration must respect the dependency order below.
- Production behavior checks must prove relationship and state consistency, not only successful HTTP responses or page rendering.
- Explorer v1 is a bounded presentation layer over approved contracts. It does not add a separate collector, scheduled job, request-time full-history scan, or Explorer-specific historical analytics pipeline.
- Explorer v2 is gated behind O1 and O2. It does not define Observatory metrics ad hoc.
- Before every new implementation unit, operational probe, release-preparation unit, or externally visible configuration change, follow `AGENTS.md`: re-read this roadmap and `implementation-status.md`, and reconcile them after evidence changes gates, blockers, sequencing, or measured resource state.
- Before every Explorer or Observatory implementation unit, also re-read `explorer-spec.md`, `observatory-roadmap.md`, `resource-envelope.md`, and the affected UI and data specifications.

## Active post-head execution order

M1 exited on retained 2026-07-08 UTC evidence. The first M5-5 D1-gated production cross-audit then passed against live Devnet data at 2026-07-08 00:52:38 UTC. API-level current/history, lifecycle/current, archive/current exclusion, live relationships, bounded exports, Activity result classification, Cover & Loss availability, snapshot identity, and freshness/lag checks are observed.

M5-5 browser regression, representative browser behavior smoke, the independent production UI audit, and unimpairment candidate review are currently blocked by collector recovery. The 64-ledger/run five-minute Free-tier profile failed in retained post-reset evidence on 2026-07-10 with Worker subrequest-limit errors, zero cursor advancement, and growing lag despite safe D1 daily usage. These tracks resume only after retained collector evidence shows healthy status, zero failures, safe D1 headroom, and lag reduction or zero-lag health.

### Permanent monitoring track

1. Run the lightweight read-only runtime monitor every 30 minutes.
2. Check collector status, cursor, observed head, lag, run usage, failures, current error, replacement-base binding, hybrid-history source state, and actual D1 daily usage.
3. Run guarded deep semantic diagnostics every 6 hours.
4. Check HYB-7 source/projection evidence, ledger continuity, created/modified/deleted changes, overlay/tombstone agreement, LoanPay and LoanManage activity, impairment/unimpairment/default transitions, lifecycle, archive, balance history, linkage gaps, and M1 gate states.
5. Defer deep scans when the existing D1 read guard requires deferral. Do not weaken the guard merely to obtain release evidence.

### Track A — M5-5 real-data integration path

1. Preserve permanent monitoring and the completed M1 exit evidence.
2. Preserve the passing D1-gated production cross-audit evidence and durable manual audit workflow.
3. Treat API-level current/history, lifecycle/current, archive/current exclusion, live relationship, bounded export/feed, snapshot identity, and freshness/lag checks as observed from the retained cross-audit evidence.
4. Preserve Activity result-code classification: successful and non-success protocol transactions are both valid indexed evidence and are counted separately rather than rejecting non-success events.
5. Run real-data browser regression across representative Overview, entity list/detail, Activity, Lifecycle, Archived Objects, Cover & Loss, Search, and Network Status routes.
6. Run representative browser production behavior smoke with live identifiers and prove route-level relationship, archive/current, history/current, lifecycle/current, and freshness presentation consistency.
7. Reconcile M5-5 exit only after the browser regression and representative production behavior smoke pass.

### Track B — UI production-audit path

1. After a UTC-day reset or later safe point, dispatch the self-enforcing production audit and let its actual D1 usage measurement decide eligibility.
2. Run the production screenshot crawl only when the existing below-80% headroom policy passes and collector healthy zero-lag preflight passes.
3. Capture the representative desktop/mobile route matrix plus the open mobile More menu.
4. Require exact expected route/profile diagnostic coverage, reject missing, duplicate, or unexpected route and technical-profile records, classify page-level horizontal overflow separately from nested overflow review candidates, aggregate browser console, page, and HTTP errors, and retain JSON and Markdown summaries. Technical evidence failure stops the audit after evidence files are written.
5. Inspect generated summaries, raw manifest and diagnostics, and screenshots together. Human visual review remains required even when strict technical evaluation passes.
6. Remediate confirmed overflow, clipping, spacing, fixed-navigation overlap, safe-area, long-identifier, table, form-layout, and mobile-navigation defects.
7. Re-audit affected routes using the same route, viewport, diagnostic, and evidence-summary shape.

Tracks A and B may progress in parallel, but neither may weaken collector integrity or D1 resource guards.

### Post-M1 release path

After M1 exit:

1. M5-5 cross-audit real-data integration.
2. Bounded exports against the live evidence boundary.
3. Real-data browser regression.
4. Current/history consistency checks.
5. Lifecycle/current-object cross-checks.
6. Archive/current exclusion checks.
7. Bounded D1-aware production behavior smoke across representative list/detail and audit routes, including relationship integrity and freshness claims.
8. M6 integrity/reset simulations and runtime/resource guardrails.
9. Explorer v1 E1-1 through E1-5 from `observatory-roadmap.md`.
10. Final post-integration production visual audit and remediation re-audit, including `/explore`.
11. Accessibility, performance, security, and cross-browser validation, including `/explore`.
12. Final public-host binding for canonical URLs, sitemap, structured data, and social metadata.
13. Owner-managed public subdomain, valid GA4 configuration, Search Console verification, and sitemap submission.
14. Operations/deployment documentation finalization.
15. Backup/export and recovery verification.
16. Real multi-day Devnet soak.
17. Final release verification.
18. After stable release and real soak evidence, begin O1 Observatory data-foundation work.
19. Begin O2 Observatory monitoring view only after O1 contracts are stable.
20. Begin O3 Explorer v2 only after O2 establishes canonical technical metric interpretation and stable bounded APIs.

## M0 — Foundation and specification lock

Complete.

Delivered product, architecture, data, status, asset, collector, testing, resource, roadmap, and UI specifications; pinned toolchain; local and production boundaries; and Mainnet fail-closed configuration.

## M1 — Current-state collector

### Completed foundation

- network, amendment, epoch, reset, and synchronization state;
- canonical XRP, IOU, and MPT normalization;
- complete unfiltered marker traversal primitives;
- exact-marker resumable bootstrap batches;
- current object normalization and relationship checks;
- terminal Loan zero-omission handling;
- long-running bootstrap runner;
- deterministic compressed artifact generation;
- complete manifest verification;
- verified full Devnet base snapshot materialization;
- lightweight current-state read-model compilation;
- immutable base data publication and active channel resolution;
- bounded current Vault, Loan Broker, and Loan list/detail readers;
- bounded pagination, exact identifier lookup, filters, relationships, and search validation;
- incremental validated-ledger scan foundation;
- AffectedNodes normalization;
- Loan lifecycle derivation;
- deleted-object archive derivation;
- cover, debt, and loss history derivation;
- deterministic cursor and parent-hash continuity checks.

The row-per-object D1 full-snapshot approach exceeded the project resource safety envelope in measured projection and does not proceed to production. M1 now completes through a verified immutable base read model plus bounded D1 incremental history and current-state overlay.

### M1-HYB-0 — Documentation and dependency realignment

Target: 2026-07-04.

- supersede the D1-only current-state decision;
- align architecture, collector design, resource envelope, implementation status, and roadmap;
- retain the evaluated D1-only plan as historical evidence rather than an active execution plan;
- define public-safe base-plus-overlay semantics and the new dependency order.

Exit condition: source-of-truth documents agree with the implemented base read path and the next incremental work.

### M1-HYB-1 — D1 incremental overlay foundation

Target: 2026-07-05.

- add bounded overlay records for created and modified current objects;
- add deletion tombstones for objects removed after the base ledger;
- bind every overlay row to network, epoch, base snapshot identity, ledger, and transaction evidence;
- add overlay watermark and indexes required by detail, list, search, relationship, and overview reads;
- prove idempotent replay and fail-closed base identity mismatch behavior.

Exit condition: replay creates no duplicate canonical overlay state, deletion cannot fall through to the base, and base mismatch fails closed.

### M1-HYB-2 — Incremental projection integration

Target: 2026-07-06.

- derive current projection upserts from supported CreatedNode and ModifiedNode changes;
- derive current-state tombstones from DeletedNode changes;
- persist history, lifecycle, archive, balance, overlay, and cursor movement at the documented canonical commit boundary;
- keep cursor and parent-hash gap rejection intact;
- prove all-or-nothing advancement between historical evidence and current-state overlay.

Exit condition: history and current overlay advance together or neither advances.

### M1-HYB-3 — Base-plus-overlay API integration

Target: 2026-07-07.

- merge base and overlay semantics into Overview;
- merge Vault list/detail reads;
- merge Loan Broker list/detail reads;
- merge Loan list/detail reads;
- merge exact Search and Account/relationship reads;
- ensure tombstones suppress current results and route users to indexed archive context where available;
- expose base identity, overlay watermark, collector cursor, and freshness metadata.

Exit condition: current entity routes deterministically resolve overlay upsert > base, tombstone > hidden, otherwise base.

### M1-HYB-4 — Scheduled incremental collector wiring

Target: 2026-07-08.

- connect bounded incremental ledger processing to the scheduled Worker path;
- retain network-status refresh independently;
- cap ledgers, requests, statements, rows, retries, and execution time per run;
- process only contiguous validated ledger ranges;
- catch up across multiple runs instead of skipping or over-running runtime limits;
- expose lag, stale state, error state, and last successful cursor.

Target cadence: once per minute, subject to measured Worker, D1, and RPC evidence. The interface reports actual freshness rather than assuming the target cadence was met.

Exit condition: scheduled runs advance contiguously, restart safely, and remain within measured guardrails.

### M1-HYB-5 — Catch-up rehearsal and reconciliation

Target: 2026-07-09.

- rehearse catch-up from a fixed base ledger plus one;
- interrupt and resume collection;
- replay already processed ranges;
- verify parent-hash continuity;
- reconcile base counts plus created/deleted overlay deltas;
- reconcile Vault to Loan Broker and Loan Broker to Loan relationships;
- verify deleted objects are absent from current routes and retained in indexed history where collected.

Exit condition: catch-up, interruption, replay, and reconciliation evidence pass without current/history divergence.

### M1-HYB-6 — Bounded production catch-up

Target start: 2026-07-10.

- begin bounded production catch-up from the ledger after the active verified base snapshot;
- preserve the fixed base identity while the overlay advances;
- stop on any gap, parent-hash discontinuity, reset signal, or persistence failure;
- expose actual lag until catch-up reaches the validated head.

Exit condition: production cursor reaches the validated head without a gap and current routes reflect base plus applied overlay.

### M1-HYB-7 — Continuous Devnet monitoring verification

Target: 2026-07-11.

Verify real observed paths for:

- newly created current objects;
- modified current objects;
- Loan payment changes;
- impairment, unimpairment, and default state transitions;
- deletion and archive handling;
- Activity, lifecycle, balance history, and current-state consistency;
- lag and freshness reporting.

Exit condition: the live continuation path is operational and evidence shows current and historical views remain consistent.

Latest recorded bounded semantic probe state on 2026-07-07 at 21:08 UTC: the collector was healthy, the processed continuation `3432925..3472761` contained `39837` ledgers with zero discontinuities, and all required HYB-7 paths were observed. The previously missing natural unimpairment path is now observed, including one `unimpaired` lifecycle transition with latest ledger `3470076`, and the continuation report passed. `liveContinuation` is observed. The same probe had cursor `3472761` and observed head `3472781`, so strict M1 `validatedHeadReached` remained missing and overall M1 readiness remained false.

A later bounded lightweight recheck captured at 2026-07-07 21:57 UTC sampled the collector three times over 40 seconds. All three samples were healthy with cursor and observed head both `3473715`, reported lag `0`, zero consecutive failures, no current error, and exact cursor/head equality. This closes the operational gap seen in the earlier semantic probe, but M1 still requires a guarded diagnostic state and readiness-enforced exit artifact proving the complete gate set together.

### M1-HYB-8 — M1 exit review

Target: 2026-07-12, evidence-dependent.

M1 exits only when:

- a verified base read model is serving real Devnet current data;
- the incremental cursor advances contiguously and remains healthy at the validated head;
- current overlay upserts and tombstones are applied safely;
- restart and retry are idempotent;
- bounded catch-up works after interruption;
- stale or incomplete data is never labeled fresh;
- required HYB-7 live paths are observed and consistent;
- reconciliation passes;
- the reproducible M1 exit review passes with readiness enforcement.

### Parallel release-preparation track during M1 completion

Preparation that may proceed without mutating collector, D1, history, or deployment state includes:

- route-specific title and description requirements;
- canonical-host, robots, sitemap, Open Graph, social-card, and accurate structured-data requirements;
- analytics configuration hooks without placeholder measurement IDs;
- manual-dispatch GitHub Actions screenshot-audit workflow;
- representative desktop/mobile route matrix including data pages, detail pages, documentation pages, and the open mobile More menu state;
- screenshot capture hardening, technical layout/runtime diagnostics, deterministic evidence summarization, and strict technical-evidence evaluation.

The following remain gated until a verified healthy fresh head and current D1 resource headroom are confirmed:

- full production screenshot crawl of the representative route matrix;
- UI remediation based on that production visual evidence.

The read-only candidate-review and external witness path is no longer active while the newly observed natural unimpairment evidence remains valid and consistent.

The following remain gated until M1 exit and a final public host is configured:

- production canonical-host activation;
- final absolute sitemap publication;
- Google Search Console verification and sitemap submission;
- public launch indexing decisions.

The collector is not slowed, reset, rebased, or retuned solely to make room for release-preparation tasks.

## M2 — Event history and lifecycle

Complete in dependency order:

1. incremental validated-ledger foundation;
2. AffectedNodes normalization;
3. Loan lifecycle engine;
4. archived-object retention;
5. cover, debt, and loss tracking;
6. status engine and reconciliation;
7. Checkpoint B history decision.

Historical logic is implemented, but production completeness remains bounded by the collection start, M1 contiguous continuation, reconciliation, and later soak evidence.

## M3 — Public API

Complete through contracts, exports, and feeds:

- status and overview;
- Vault, Loan Broker, and Loan list/detail contracts;
- activity and transaction detail;
- search and account relationships;
- epochs and object history;
- lifecycle, archives, cover/loss audit endpoints;
- bounded exports and feeds.

The completed M1 path serves base-plus-overlay current reads and freshness metadata. M5-5 now cross-audits those current reads against indexed history and representative production behavior.

## M4 — Baseline UI and project pages

Complete through Checkpoint C:

- responsive application shell;
- Overview and Network Status;
- Vault, Loan Broker, and Loan list/detail pages;
- Activity, transaction, Search, and account pages;
- About, Methodology, API, and Contact pages;
- shared loading, empty, unavailable, stale, partial, error, archived, not-found, and invalid-identifier states;
- responsive and accessibility coverage.

The UI must not claim real-time freshness unless current runtime evidence supports that claim.

## M5 — Differentiated audit UI

Complete:

- M5-1 Loan lifecycle and state changes;
- M5-2 archived objects;
- M5-3 cover, debt, and loss;
- M5-4 Devnet epochs and provenance.

### M5-5 — Cross-audit real-data integration

Target: active from 2026-07-08 after successful M1 exit. Evidence state controls completion.

- cross-audit integration;
- bounded exports against the live evidence boundary;
- real-data browser regression;
- current/history consistency checks;
- lifecycle/current-object cross-checks;
- archive/current exclusion checks;
- bounded production behavior smoke across representative Overview, entity list/detail, Activity, Lifecycle, Archived Objects, Cover & Loss, Search, and Network Status routes;
- relationship verification through live identifiers, including Loan to Loan Broker and Loan Broker to Vault linkage where applicable;
- freshness and lag claim verification against collector status.

Exit condition: audit integration and production behavior smoke pass against verified base-plus-overlay current state and indexed real history.

M1 exit evidence recorded for this dependency: at 2026-07-08 00:13:44 UTC the collector was healthy with cursor and observed head both `3476415`, lag `0`, zero consecutive failures, HYB-7 passed with every path observed, and M1 diagnostics reported `ready: true` with all four gates observed.

First M5-5 production cross-audit evidence: at 2026-07-08 00:52:38 UTC the collector was healthy with cursor and observed head both `3477191`, lag `0`, and zero consecutive failures. Snapshot `devnet-3432924-canonical` matched Overview and current Vault, Loan Broker, and Loan reads. Loan to Loan Broker and Loan Broker to Vault links were consistent; a lifecycle-backed current Loan matched indexed lifecycle and bounded object history; an exact archived Loan was available in archive history and returned `404` from current state; Activity returned 100 rows classified as 77 successful and 23 non-success protocol transactions; Archived Objects returned 25 rows; Cover & Loss returned 100 rows; JSON, NDJSON, CSV, and feed NDJSON Activity exports each returned 25 bounded rows. The audit passed. D1 usage at capture time was 946,159 rows read and 3,414 rows written, so the unchanged headroom gate passed. Human screenshot review remains a separate Track B requirement.

## M6 — Hardening and public Devnet release

Target start: 2026-07-15, after M1 exit and M5-5. Dependency state controls the start date.

Proceed in dependency order:

1. integrity and reset simulations;
2. runtime and resource guardrails;
3. Explorer v1 E1-1 through E1-5 as defined by `explorer-spec.md` and `observatory-roadmap.md`;
4. final post-integration full-page visual audit of representative desktop and mobile routes against production data, including `/explore`;
5. UI overflow, clipping, spacing, fixed-navigation overlap, safe-area, long-identifier, graph/list alternative, and form-layout remediation followed by screenshot re-audit;
6. accessibility, performance, security, and cross-browser validation, including `/explore`;
7. SEO and discoverability finalization: route-specific metadata, final-host canonical URLs, robots policy, sitemap, social metadata, and accurate structured data;
8. owner-managed public-host, analytics, and Search Console setup after final host selection; repository code must expose configuration hooks and must not ship placeholder IDs or verification tokens;
9. operations and deployment documentation;
10. backup/export and recovery verification;
11. real multi-day Devnet soak;
12. final release verification.

Explorer v1 start gate:

- M5-5 has exited from browser evidence rather than API evidence alone;
- M6 integrity/reset simulation work has established its baseline;
- runtime and resource guardrails are available to measure Explorer request, D1-read, base-read, cache, and representative interaction cost.

Explorer v1 exit does not complete M6. The route must then pass the remaining full visual, accessibility, performance, security, cross-browser, discoverability, operations, recovery, soak, and final release gates with the rest of the application.

Completion has no artificial date. Soak evidence requires real elapsed time and is never fabricated or compressed.

## Post-release XRPL Lending Observatory expansion

The approved expansion order is:

### O1 — Observatory data foundation

Begin only after the stable Monitor release boundary and real soak evidence.

Define bounded incremental historical metrics and series. Every metric requires an approved source, formula or event derivation, canonical asset scope, observation-window semantics, provenance, missing-data behavior, retention, epoch/reset behavior, replay behavior, resource budget, API contract, and reconciliation rule.

User page traffic must not trigger full-history aggregation. Prefer incremental current metrics and hourly or daily rollups only where justified by measured value and resource cost.

### O2 — Observatory monitoring view

Begin only after O1 contracts are stable and resource evidence passes.

Establish the canonical technical monitoring interpretation of protocol change, activity, trends, utilization, debt, payment, impairment, unimpairment, default, deletion, cover, and loss metrics that have approved O1 contracts.

Historical ranges remain bounded. Missing intervals are not interpolated as fact. Every chart has an accessible alternative and preserves asset, epoch, freshness, provenance, and observation-window context.

### O3 — Explorer v2

Begin only after O2 establishes stable bounded APIs and canonical technical metric interpretation.

Extend the guided Explorer with historical time series, period comparisons, payment and lifecycle timelines, relationship exploration, and guided explanations of material changes using existing Observatory contracts.

Explorer v2 does not define new metrics ad hoc. Any new visualization requiring a new metric returns to the O1 contract process before implementation.

Detailed requirements and completion gates are defined in `explorer-spec.md` and `observatory-roadmap.md`.