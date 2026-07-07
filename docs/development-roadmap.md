# Development roadmap

Baseline date: 2026-07-01.
Last recalibrated: 2026-07-08.

This document controls implementation order and dependencies. Dates are planning targets rather than promises. Correctness, data integrity, accessibility, and release evidence take priority over calendar targets.

The current M1 execution path is a verified immutable base read model plus bounded D1 incremental history and current-state overlay. The earlier D1-only full-snapshot plan is retained as architectural history in [`d1-migration-plan.md`](d1-migration-plan.md) but no longer controls active implementation order.

## Milestone summary

| Milestone | Status | Goal | Exit condition |
|---|---|---|---|
| M0 Foundation and specification lock | Complete | Establish repository, source-of-truth documents, toolchain, and operating rules | Documentation accepted and project skeleton ready |
| M1 Current-state collector | All HYB-7 paths and exact-head equality observed; guarded exit review active | Serve a verified Devnet base state and continuously apply validated ledger changes | Verified base read model serves real Devnet data; contiguous scheduled collection remains healthy at a strict fresh head; required HYB-7 paths and M1 exit review pass |
| M2 Event history and lifecycle | Complete through Checkpoint B | Normalize validated history, lifecycle, archives, balances, and status | Deterministic replay and reconciliation logic complete; production completeness remains bounded by M1 continuation and later soak evidence |
| M3 Public API | Complete through exports and feeds; current merge integration pending final real-data cross-audit | Expose bounded read-only current and historical APIs | Base-plus-overlay current routes and historical contracts pass, with explicit freshness and unavailable states |
| M4 Baseline UI and project pages | Complete through Checkpoint C | Deliver the ordinary monitor, navigation, project pages, responsive behavior, and shared states | Required baseline routes work end to end; live freshness claims remain gated by verified runtime evidence |
| M5 Differentiated audit UI | Complete through M5-4; M5-5 gated behind M1 | Add lifecycle, archives, cover/loss, epochs, provenance, and cross-audit integration | Audit integration and bounded production behavior smoke pass against verified real data after M1 exits |
| M6 Hardening and public Devnet release | Release-preparation implementation active; final hardening gated by M1 and M5-5 | Prove integrity, resource safety, accessibility, discoverability, operations, and deployment readiness | Final visual audit, production behavior smoke, SEO/discoverability, recovery verification, multi-day soak, and all release gates pass |

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
- Before every new implementation unit, operational probe, release-preparation unit, or externally visible configuration change, follow `AGENTS.md`: re-read this roadmap and `implementation-status.md`, and reconcile them after evidence changes gates, blockers, sequencing, or measured resource state.

## Active post-head execution order

The recorded evidence now includes all required HYB-7 paths, natural post-boundary unimpairment, passing continuation diagnostics, and three consecutive lightweight samples with exact cursor/head equality. M1 now proceeds to guarded diagnostics and the readiness-enforced exit review at a D1-safe point while permanent monitoring and the D1-gated UI audit track continue.

### Permanent monitoring track

1. Run the lightweight read-only runtime monitor every 30 minutes.
2. Check collector status, cursor, observed head, lag, run usage, failures, current error, replacement-base binding, hybrid-history source state, and actual D1 daily usage.
3. Run guarded deep semantic diagnostics every 6 hours.
4. Check HYB-7 source/projection evidence, ledger continuity, created/modified/deleted changes, overlay/tombstone agreement, LoanPay and LoanManage activity, impairment/unimpairment/default transitions, lifecycle, archive, balance history, linkage gaps, and M1 gate states.
5. Defer deep scans when the existing D1 read guard requires deferral. Do not weaken the guard merely to obtain release evidence.

### Track A — M1 completion path

1. Preserve healthy operation, source-layout invariants, passing HYB-7 continuation evidence, and the naturally observed post-boundary unimpairment evidence.
2. Preserve the 2026-07-07 21:57 UTC lightweight evidence showing three healthy samples with cursor and observed head both `3473715` and exact equality in every sample.
3. Do not run candidate discovery or a deliberate external witness while the natural unimpairment source/lifecycle evidence remains observed and consistent.
4. At a D1-safe point, run guarded M1 diagnostics and require every M1 gate to be observed together.
5. Run the reproducible M1 exit review with `require_ready=true`.
6. Retain the exit artifact and reconcile roadmap/status from that evidence.
7. Proceed to M5-5 only after M1 exit is complete.

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
9. Final post-integration production visual audit and remediation re-audit.
10. Accessibility, performance, security, and cross-browser validation.
11. Final public-host binding for canonical URLs, sitemap, structured data, and social metadata.
12. Owner-managed public subdomain, valid GA4 configuration, Search Console verification, and sitemap submission.
13. Operations/deployment documentation finalization.
14. Backup/export and recovery verification.
15. Real multi-day Devnet soak.
16. Final release verification.

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

The active M1 work integrates base-plus-overlay current reads and freshness metadata into the current entity routes. Historical APIs remain bounded by collected evidence.

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

Target: 2026-07-13 through 2026-07-14, after M1 exit. Dependency state controls the start date.

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

## M6 — Hardening and public Devnet release

Target start: 2026-07-15, after M1 exit and M5-5. Dependency state controls the start date.

Proceed in dependency order:

1. integrity and reset simulations;
2. runtime and resource guardrails;
3. final post-integration full-page visual audit of representative desktop and mobile routes against production data;
4. UI overflow, clipping, spacing, fixed-navigation overlap, safe-area, long-identifier, and form-layout remediation followed by screenshot re-audit;
5. accessibility, performance, security, and cross-browser validation;
6. SEO and discoverability finalization: route-specific metadata, final-host canonical URLs, robots policy, sitemap, social metadata, and accurate structured data;
7. owner-managed public-host, analytics, and Search Console setup after final host selection; repository code must expose configuration hooks and must not ship placeholder IDs or verification tokens;
8. operations and deployment documentation;
9. backup/export and recovery verification;
10. real multi-day Devnet soak;
11. final release verification.

Completion has no artificial date. Soak evidence requires real elapsed time and is never fabricated or compressed.
