# XRPL Lending Observatory expansion roadmap

## Purpose

This document defines the approved implementation sequence that extends XRPL Lending Monitor with Explorer v1 and later evolves the project into XRPL Lending Observatory.

It does not replace the active M0-M6 execution details in `development-roadmap.md`. It adds the approved product-evolution sequence and defines when Explorer v1, Observatory data work, the Observatory monitoring view, and Explorer v2 may begin.

The implementation order is intentionally conservative because the current product already operates under measured Worker, D1, storage, and audit constraints.

## Approved sequence

```text
M5-5 completion
        |
        v
M6 early hardening
  |- integrity/reset simulation
  `- runtime/resource guardrails
        |
        v
Explorer v1
        |
        v
M6 final visual and release hardening
        |
        v
public Devnet release and real soak
        |
        v
O1 Observatory data foundation
        |
        v
O2 Observatory monitoring view
        |
        v
O3 Explorer v2
```

The order is mandatory unless a later accepted decision explicitly supersedes it.

## Current active boundary

As of 2026-07-08, the repository records:

- M1 complete;
- M2 complete through the approved history/lifecycle boundary;
- M3 public API contracts, exports, and feeds complete through the current integration boundary;
- M4 baseline UI complete through Checkpoint C;
- M5-5 API cross-audit evidence passing;
- real-data browser regression and representative browser production behavior smoke still required before M5-5 exit;
- M6 gated behind M5-5.

Explorer implementation must not interrupt or weaken the active M5-5 browser verification path.

## Explorer v1 pre-entry design preparation

Pre-entry design preparation may proceed before the E1 start gate only when it is documentation/design work that does not change runtime behavior, public routes, API contracts, collector behavior, D1 persistence, schedules, deployment, or resource thresholds.

Approved pre-entry preparation may include:

- comparison and approval of visual mockup directions;
- textual recording of the accepted visual composition;
- mapping planned sections to candidate existing contracts;
- identifying initial-load versus lazy-load boundaries;
- drafting plain-language concept and field translations;
- drafting Activity success/non-success translation rules;
- defining bounded relationship interaction principles;
- identifying accessibility alternatives;
- identifying resource measurements required by later E1 work;
- documenting unresolved endpoint choices for measured E1-1 review.

Pre-entry preparation must not:

- create `/explore` in production;
- add Explore navigation as if the page were implemented;
- implement Explorer components or runtime data fetching;
- add a dedicated Explorer endpoint;
- add Explorer-only persistence;
- add a new collector or scheduled job;
- add request-time historical aggregation;
- set numeric relationship or request budgets without M6 resource evidence;
- claim E1-1 complete;
- satisfy or bypass the E1 start gate.

The approved pre-entry documents are:

- `explorer-v1-visual-direction.md`;
- `explorer-v1-contract-matrix.md`;
- `explorer-v1-translation-dictionary.md`;
- `explorer-v1-relationship-contract.md`.

These documents prepare E1-1. At E1-1 start they must be revalidated against:

- actual M5-5 exit evidence;
- M6 integrity/reset evidence;
- M6 runtime/resource evidence;
- the Explorer measurement harness;
- final approved API response shapes;
- final normalized Activity semantics.

An unresolved pre-entry assumption never becomes an implementation contract merely because it appears in a mockup or draft document.

## E1 — Explorer v1

### Start gate

Explorer v1 starts only after:

1. M5-5 exits from browser evidence rather than API evidence alone;
2. M6 integrity/reset simulation work has established its required baseline;
3. M6 runtime and resource guardrails are available for evaluating Explorer request and query cost.

This placement intentionally occurs before the final full visual audit, accessibility, performance, security, and cross-browser release passes so that Explorer v1 is included in those final gates.

### Goal

Add one beginner-oriented guided public route that translates already approved protocol data and relationships without adding a parallel collector or historical analytics system.

### Approved visual direction

Explorer v1 uses the approved Guided Dashboard + Relationship Explorer hybrid documented in `explorer-v1-visual-direction.md`.

The design:

- teaches vocabulary before showing complex relationships;
- shows bounded current facts before relationship exploration;
- distinguishes conceptual protocol flow from observed relationships;
- uses a bounded relationship explorer as the primary project-specific visual feature;
- provides one readable selected-Loan summary;
- translates recent Activity while retaining canonical evidence;
- provides glossary/help and transitions to technical views;
- remains visually consistent with the current Monitor;
- does not use lighthouse, observatory-building, scenic landscape, or decorative Hero illustration.

### Scope

The canonical route is:

```text
/explore
```

The implementation unit covers:

- guided protocol flow explanation;
- bounded current summary cards;
- bounded Vault -> Loan Broker -> Loan relationship presentation;
- human-readable Loan cards;
- recent Activity translation that retains canonical transaction type and result;
- compact glossary and provenance explanation;
- links back to technical Monitor, Audit, and Methodology surfaces;
- stale, partial, unavailable, empty, and error states;
- desktop, tablet, mobile, keyboard, screen-reader, zoom, reflow, and reduced-motion behavior;
- request, D1-read, base-read, cache, and representative interaction measurements.

### Explicit non-scope

Explorer v1 does not include:

- a new collector;
- a new scheduled job;
- page-specific periodic recomputation;
- arbitrary historical range queries;
- protocol-wide historical trend charts requiring new Observatory aggregates;
- full payment-history reconstruction beyond indexed contracts already approved;
- fiat valuation;
- cross-asset totals;
- risk or credit scoring;
- wallet, signing, or transaction controls.

### Suggested implementation units

#### E1-1 — Contract and composition review

- re-read and revalidate all Explorer v1 pre-entry design documents;
- map each Explorer section to existing API contracts;
- confirm or revise candidate sources in the contract matrix using actual API shapes;
- identify where one bounded composition endpoint would reduce repeated reads, if any;
- define initial request budget from M6 resource evidence;
- define current-state, relationship, activity, and detail-loading states;
- confirm no Explorer-only scheduled persistence is required;
- confirm translation conditions against actual normalized Activity semantics;
- select bounded relationship anchor/loading model from measured evidence.

Exit condition: every displayed value and relationship has an approved source and provenance category, translation rules match actual evidence semantics, and the expected initial-load query plan is bounded and measured.

#### E1-2 — Shell, route, and educational flow

- add `/explore` route;
- add approved navigation entry;
- implement Hero, scope statement, three-concept explanation, protocol flow explanation, and technical-view transitions;
- implement explicit network, freshness, and unavailable behavior;
- follow the approved same-product Hero treatment without scenic/lighthouse illustration.

Exit condition: the page is navigable and understandable before advanced visualizations are added.

#### E1-3 — Bounded current summaries and relationship view

- implement current summary cards from approved contracts;
- implement bounded Vault -> Loan Broker -> Loan structure view;
- provide graph/tree and accessible list alternatives where applicable;
- lazy-load selected object detail;
- prevent N+1 page-load fetching;
- follow `explorer-v1-relationship-contract.md` and measured M6 harness limits.

Exit condition: relationship navigation is bounded, same-context, accessible, and measurable.

#### E1-4 — Human-readable Loans and Activity translation

- implement summary-first Loan cards;
- preserve separate on-ledger and schedule states;
- implement plain-language Activity summaries while retaining canonical transaction type, result, ledger, hash, and affected objects;
- expose technical detail links or drawers;
- revalidate implementation wording against `explorer-v1-translation-dictionary.md` and actual API/event semantics.

Exit condition: users can understand a representative Loan and recent event without losing access to exact evidence or changing canonical meaning.

#### E1-5 — Explorer production evidence

- measure initial page-load requests;
- measure D1 rows read and base read-model access where applicable;
- measure one representative detail interaction;
- measure one representative relationship expansion interaction;
- verify cache behavior where a real cache exists;
- run production-shaped browser behavior smoke;
- include `/explore` in representative desktop/mobile screenshot audit;
- verify stale, partial, unavailable, empty, and error states;
- complete accessibility and responsive evidence.

Exit condition: Explorer v1 passes the same release integrity and resource expectations as the rest of the public application.

## M6 continuation after Explorer v1

After E1 exits, continue the existing M6 dependency order with Explorer included in the release surface:

1. final post-integration full-page visual audit;
2. confirmed UI remediation and re-audit;
3. accessibility validation;
4. performance validation;
5. security validation;
6. cross-browser validation;
7. SEO and discoverability finalization;
8. final public-host and analytics/search setup;
9. operations and deployment documentation;
10. backup/export and recovery verification;
11. real multi-day Devnet soak;
12. final release verification.

Explorer v1 does not bypass any of these gates.

## Observatory transition rule

The project name remains **XRPL Lending Monitor** during the initial Devnet release and Explorer v1 work.

The term **XRPL Lending Observatory** applies to the approved expansion phase that begins after the stable Monitor release boundary and real soak evidence.

Observatory work begins with data contracts and resource design, not with charts.

## O1 — Observatory data foundation

### Goal

Establish bounded, reusable, incrementally maintained historical metrics and series that support protocol-wide monitoring without repeatedly scanning raw history on user requests.

### Required design work

For every proposed metric or series, define:

- user question answered;
- source events and source tables;
- canonical asset scope;
- event-time and ledger-time semantics;
- formula or event derivation;
- current metric representation;
- hourly rollup need, if justified;
- daily rollup need, if justified;
- retention window;
- provenance category;
- missing-data behavior;
- incomplete-history boundary;
- reset and epoch behavior;
- replay and idempotency behavior;
- D1 write amplification;
- D1 read profile;
- storage growth projection;
- API contract;
- reconciliation rule.

### Candidate metric families

Candidate families include:

- outstanding debt by canonical asset;
- bounded period debt change;
- Loan creation activity;
- payment activity;
- impairment activity;
- unimpairment activity;
- default activity;
- deletion activity;
- Vault utilization series;
- Loan Broker debt utilization series;
- cover availability and cover ratio series where formula inputs are approved;
- cover surplus or shortfall series;
- LossUnrealized series;
- Loan lifecycle distribution over documented observation windows.

Candidate status does not authorize publication. Each public metric requires an accepted contract.

### Architecture direction

Preferred shape:

```text
validated protocol events
        |
        v
canonical incremental processing
        |
        +--> current metric state
        +--> hourly rollup where justified
        +--> daily rollup where justified
        |
        v
bounded Observatory API
```

Rules:

- user page traffic does not trigger full-history aggregation;
- one approved aggregate contract serves multiple presentation surfaces;
- replay is idempotent;
- current and historical metrics share epoch boundaries correctly;
- incomplete observation windows are explicit;
- unlike assets are not combined;
- retention is measured before indefinite accumulation is approved.

### O1 completion condition

O1 exits only when:

- initial Observatory metric contracts are approved;
- incremental maintenance is deterministic and replay-safe;
- resource measurements and growth projections pass the safety envelope;
- retention and reset behavior are documented;
- API responses expose provenance and observation-window boundaries;
- reconciliation against canonical events passes.

## O2 — Observatory monitoring view

### Goal

Create the technical monitoring surface for historical change, activity, trends, and protocol-wide observation using the stable O1 contracts.

### Initial responsibilities

The Observatory monitoring view may provide:

- protocol activity over documented windows;
- debt movement by canonical asset;
- payment activity;
- impairment, unimpairment, and default activity;
- deletion and archive activity;
- utilization history;
- cover and loss history;
- metric freshness and observation-window completeness;
- source event and methodology links.

### Design rules

- technical interpretation is established here before Explorer v2 simplifies or guides it;
- charts use stable documented series only;
- no line interpolation hides missing intervals;
- every chart has an accessible table or equivalent data representation;
- current state, indexed history, and rollup series remain distinguishable;
- asset-separated series remain separate;
- charts do not imply prediction, yield, safety, or creditworthiness.

### O2 completion condition

O2 exits when:

- the initial Observatory metrics are displayed consistently with their contracts;
- technical users can trace metrics to Methodology and source evidence;
- range controls are bounded;
- query and cache measurements pass;
- incomplete historical windows are explicit;
- browser, accessibility, responsive, and production behavior evidence passes.

## O3 — Explorer v2

### Start gate

Explorer v2 starts only after O1 and O2 have stable approved contracts and behavior.

### Goal

Provide guided interactive historical exploration for general users using existing Observatory contracts.

### Candidate capabilities

- historical time-series exploration;
- bounded period comparisons;
- payment timelines;
- lifecycle timelines;
- guided explanation of material protocol changes;
- Vault utilization history exploration;
- Loan Broker debt and cover history exploration;
- relationship exploration across Vault, Loan Broker, Loan, transaction, and lifecycle evidence;
- filters that preserve network, epoch, asset, provenance, and observation-window context.

### Dependency rule

Explorer v2 does not define new metrics ad hoc. If a new guided visualization needs a metric that O1/O2 do not expose, the metric returns to the Observatory contract process before the Explorer uses it.

### O3 completion condition

O3 exits only when:

- every visualization maps to a stable Observatory contract;
- historical ranges remain bounded;
- resource measurements pass;
- current versus historical versus archived context remains explicit;
- accessible alternatives are complete;
- guided language does not alter the factual meaning of technical metrics;
- technical detail and evidence remain reachable.

## Free-operation discipline

The approved expansion assumes free-tier operation remains a design target, not a guarantee.

The project therefore follows these rules:

- static presentation complexity is preferred over repeated database work;
- one collected event stream supports all views;
- one aggregate contract supports both Observatory monitoring and Explorer v2 where possible;
- full-history request-time scans are prohibited;
- detail data is loaded lazily;
- list and relationship reads remain bounded;
- aggregates are incremental;
- hourly and daily rollups are added only where measured value justifies write and storage cost;
- D1 read, write, and storage growth are measured before each Observatory expansion unit exits;
- retention policies are explicit before long-term accumulation is approved;
- expensive audit crawls and production evidence remain guarded by measured resource headroom.

If measured evidence shows that an Observatory feature cannot fit the resource envelope safely, the response is to bound, defer, precompute differently, reduce retention, or choose another documented architecture. The project does not weaken integrity or hide freshness to preserve a feature.

## Document references required before implementation

Before every Explorer or Observatory implementation unit:

1. re-read `AGENTS.md`;
2. re-read `docs/development-roadmap.md`;
3. re-read `docs/implementation-status.md`;
4. re-read `docs/explorer-spec.md`;
5. re-read this document;
6. re-read `docs/resource-envelope.md`;
7. re-read `docs/m6-integrity-reset-plan.md` and `docs/m6-resource-guardrail-plan.md` where their evidence gates apply;
8. re-read the four Explorer v1 pre-entry design documents before E1-1 through E1-5;
9. re-read the affected UI and data source-of-truth documents;
10. reconcile newly captured evidence into roadmap/status/resource documentation before the next dependent unit proceeds.

Conversation summaries and prior plans do not override repository source-of-truth documents.
