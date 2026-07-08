# Explorer specification

## Purpose

This document defines the approved beginner-oriented Explorer surfaces for XRPL Lending Monitor and the later XRPL Lending Observatory expansion.

The Explorer does not replace the technical Monitor, Audit, System, or Project surfaces. It is an additional read-only presentation layer that translates verified protocol facts, relationships, and activity into a more approachable guided view.

Two deliberately different implementation stages are defined:

1. **Explorer v1** — a bounded current-state guided view built from existing approved APIs and current/history contracts. It is added before the first public Devnet release is finalized.
2. **Explorer v2** — a later historical and comparative exploration surface built only after the XRPL Lending Observatory data foundation and Observatory monitoring view are established.

The sequencing is mandatory. Explorer v2 must not pull Observatory work forward into Explorer v1.

## Product relationship

The approved evolution path is:

```text
XRPL Lending Monitor
        |
        v
Explorer v1
        |
        v
XRPL Lending Observatory data foundation
        |
        v
Observatory monitoring view
        |
        v
Explorer v2
```

The responsibilities remain distinct:

- **Monitor** answers what the protocol state is and exposes exact technical detail.
- **Audit** explains recorded lifecycle, archive, cover/loss, provenance, and historical evidence.
- **Explorer v1** explains how the currently observed protocol pieces relate and what the current bounded data means.
- **Observatory monitoring view** monitors accumulated change, activity, trends, and protocol-wide historical metrics.
- **Explorer v2** lets general users interactively explore those Observatory time series, comparisons, timelines, and relationships.

## Shared rules for both Explorer versions

Both versions must:

- remain read-only;
- operate on verified public API contracts only;
- preserve Devnet, epoch, freshness, base, cursor, and provenance context where applicable;
- keep current and historical state distinct;
- keep on-ledger state and schedule-derived state distinct;
- preserve XRP, IOU, and MPT identity and exact units;
- never create cross-asset totals without an approved pricing layer;
- never invent fiat values, LTV, collateral values, credit scores, borrower identity, proprietary risk grades, or investment conclusions;
- render missing, stale, partial, unavailable, archived, and error states explicitly;
- expose technical detail through links, drawers, or expandable sections rather than hiding source identifiers;
- provide accessible non-visual alternatives for relationship graphics, charts, and timelines;
- remain usable with keyboard navigation, visible focus, reduced motion, screen readers, 200% zoom, reflow, and long identifiers;
- avoid page-load N+1 detail fetching and unbounded D1 scans;
- use bounded queries and lazy detail retrieval;
- preserve the existing technical Monitor and Audit surfaces as first-class destinations.

## Explorer v1

### Goal

Explorer v1 gives a newcomer a guided answer to three questions:

1. What are Vaults, Loan Brokers, and Loans?
2. How do the observed objects relate to each other?
3. What is happening in the currently observed lending protocol activity?

It is not a separate collector, analytics pipeline, historical warehouse, or alternate source of truth.

### Canonical route

```text
/explore
```

The public navigation label is **Explore**.

The route may carry an `Experimental view` label during its initial bounded release, but it must not be labelled `Beginner` or imply that the technical Monitor is obsolete.

### Initial page structure

Explorer v1 uses the following ordered sections.

#### 1. Hero and scope

Required content:

- page title, for example `XRPL Lending Explorer`;
- one sentence explaining that the page shows how observed Vaults, Loan Brokers, Loans, and lending activity connect;
- Devnet and read-only scope;
- freshness or stale state;
- clear link to the technical Overview.

#### 2. Protocol flow map

Show the conceptual relationship:

```text
Vault
  pools and holds lending assets
        |
        v
Loan Broker
  manages lending activity for a Vault
        |
        v
Loan
  records borrower obligations and payment schedule
        |
        v
Payment and management activity
  changes the recorded Loan lifecycle and balances
```

Rules:

- the conceptual flow explanation is educational copy, not a claim that every observed object has a complete currently resolvable relationship;
- observed counts and relationships must use actual API data;
- incomplete traversal or pagination must use `at least`, partial, or unavailable semantics rather than a false exact total;
- relationship links must resolve only within the same network and epoch, and current-state links must respect the active base and overlay semantics.

#### 3. What is happening now

Use bounded summary cards derived from approved current-state and overview contracts.

Candidate cards include:

- currently observed Vault count;
- currently observed Loan Broker count;
- currently observed Loan count;
- bounded recent protocol activity;
- current Loan state composition where supported;
- asset-separated exact values where supported.

Rules:

- do not create a global TVL card;
- do not combine unlike assets;
- do not label an amount as XRP, IOU, or MPT unless the canonical relationship and asset identity are resolved;
- do not derive 24-hour change in Explorer v1 unless a later approved indexed aggregate already exists.

#### 4. Observed lending structure

Provide a bounded relationship view such as:

```text
Vault
  |- Loan Broker
  |    |- Loan
  |    |- Loan
  |
  |- Loan Broker
       |- Loan
```

The visual form may be a graph, tree, or grouped relationship list.

Required behavior:

- start from bounded list or relationship endpoints;
- do not load all object details at page load;
- clicking an object may open a lightweight summary panel or navigate to the canonical technical detail page;
- a technical-data control may reveal exact IDs and supported raw fields;
- full identifiers remain copyable and accessible;
- large relationship sets use bounded expansion or pagination;
- an accessible text or list representation accompanies any graph-only view.

#### 5. Human-readable Loan cards

A Loan card prioritizes meaning before raw field names.

Candidate summary fields, when supported, include:

- on-ledger state;
- schedule state;
- canonical asset;
- outstanding principal;
- total value outstanding;
- periodic payment;
- payments remaining;
- next payment due;
- grace period or grace end;
- borrower account, visually shortened only;
- related Loan Broker and Vault.

Rules:

- the original canonical field names and technical detail remain reachable;
- schedule-derived labels never overwrite on-ledger state;
- no complete payment timeline is implied from current object state alone;
- date and duration formatting must identify UTC and preserve exact source semantics.

#### 6. Recent activity translation

Explorer v1 may translate supported protocol transaction types into plain-language summaries.

Example pattern:

```text
LoanPay
Scheduled loan payment recorded
```

The plain-language label supplements rather than replaces:

- transaction type;
- transaction result;
- ledger index;
- transaction hash;
- affected object links;
- available provenance.

Failed or non-success protocol transactions remain valid indexed activity evidence and must not be silently discarded.

#### 7. How to read this page

Provide a compact glossary or expandable explanations for:

- Vault;
- Loan Broker;
- Loan;
- current state;
- indexed history;
- on-ledger state;
- schedule state;
- Direct, Derived, Indexed, and Unavailable provenance.

The full Methodology page remains the technical reference.

#### 8. Technical view transition

The page ends or prominently provides links to:

- Overview;
- Vaults;
- Loan Brokers;
- Loans;
- Activity;
- Methodology.

Explorer v1 must not create duplicate canonical entity detail routes.

### API and data boundary

Explorer v1 should reuse existing approved bounded endpoints wherever practical, including:

- status and overview;
- bounded Vault list and detail;
- bounded Loan Broker list and detail;
- bounded Loan list and detail;
- bounded Activity;
- same-snapshot relationship resolution;
- exact Search or relationship endpoints when needed.

A dedicated Explorer endpoint may be added only when measurement shows that it reduces repeated reads or simplifies a stable bounded composition without weakening provenance or freshness semantics.

A dedicated Explorer endpoint must not become an unbounded aggregation service.

### Fetch strategy

The initial load should use a small bounded request set. Detail requests are lazy.

Preferred pattern:

```text
page load
  -> status/overview
  -> bounded relationship seed data
  -> bounded recent activity

user selects object
  -> exact detail request
```

Prohibited pattern:

```text
page load
  -> list
  -> one detail request for every list row
  -> one history request for every detail
```

### Resource boundary

Explorer v1 must not add:

- a new collector;
- a new scheduled job;
- a full-history scan triggered by page traffic;
- periodic page-specific D1 recomputation;
- unbounded relationship graph loading;
- unbounded time-range queries.

Visualizations based on already fetched bounded data are preferred because visual complexity does not itself require additional database work.

Before Explorer v1 exits its implementation unit, measure:

- requests per initial page load;
- D1 rows read per initial page load where applicable;
- base read-model pages or bytes read;
- requests and rows read for one representative detail interaction;
- cache behavior;
- desktop and mobile render behavior;
- accessibility of graph/list alternatives;
- stale, partial, unavailable, and error states.

### Explorer v1 completion condition

Explorer v1 is complete only when:

- `/explore` is implemented and linked in approved navigation;
- the flow map is understandable without raw ledger knowledge;
- current summary cards use verified bounded data;
- the relationship view is bounded and accessible;
- Loan cards translate supported fields without changing meaning;
- recent activity translation retains the canonical transaction type and result;
- technical detail remains reachable;
- no new collector or scheduled job is introduced;
- resource measurements pass the existing safety policy;
- browser regression, visual audit, responsive review, accessibility checks, and production-shaped behavior smoke include `/explore`.

## Explorer v2

### Dependency boundary

Explorer v2 begins only after both of the following exist:

1. the XRPL Lending Observatory data foundation has approved stable contracts for the required historical aggregates and series;
2. the Observatory monitoring view has established the canonical monitoring interpretation of those metrics.

Explorer v2 must not define Observatory metrics by itself.

### Goal

Explorer v2 turns established Observatory data into guided historical and relational exploration for non-specialist users.

Candidate capabilities include:

- historical time-series charts;
- period comparisons;
- payment and lifecycle timelines;
- protocol activity trends;
- Loan creation, payment, impairment, unimpairment, default, and deletion activity views;
- Vault utilization history;
- Loan Broker debt utilization history;
- cover and loss change views;
- relationship exploration across Vault, Loan Broker, Loan, transaction, and lifecycle evidence;
- guided explanations of material changes.

### Observatory metric dependency

Candidate Observatory metrics may include:

- current outstanding debt by canonical asset;
- bounded period debt change;
- Loan creation activity;
- repayment activity;
- impairment and unimpairment activity;
- default activity;
- deletion activity;
- Vault utilization series;
- Loan Broker debt utilization series;
- cover ratio or cover surplus/shortfall series where formulas and inputs are approved;
- Loan lifecycle distribution over documented observation windows.

These are candidates, not automatically approved public fields. Each metric requires a defined source, formula or event derivation, retention window, provenance category, missing-data behavior, asset scope, resource budget, and API contract before Explorer v2 uses it.

### Aggregate-first architecture

Explorer v2 should read stable incremental aggregates and bounded historical series rather than scan raw history on every page request.

Preferred pattern:

```text
validated protocol events
        |
        v
incremental aggregate update
        |
        +--> current metric
        +--> hourly rollup where justified
        +--> daily rollup where justified
        |
        v
bounded Observatory API
        |
        +--> Observatory monitoring view
        +--> Explorer v2
```

The same approved metric contract should support both the technical Observatory monitoring view and the guided Explorer v2 presentation.

### Explorer v2 non-goals

Explorer v2 does not automatically add:

- arbitrary unbounded historical SQL;
- raw full-history download through interactive charts;
- price oracle integration;
- fiat conversion;
- cross-asset TVL;
- proprietary risk scoring;
- personalized portfolios;
- alerts or push notifications;
- wallet or transaction features.

Each of those requires a separate approved specification.

## Naming and terminology

Use the following names consistently in repository documents and implementation:

- current product: **XRPL Lending Monitor**;
- beginner-oriented guided surface: **Explorer**;
- approved long-term expansion: **XRPL Lending Observatory**;
- technical historical/trend monitoring surface within that expansion: **Observatory monitoring view**;
- later guided historical surface: **Explorer v2**.

Do not use `Observation` as the product-phase name.

## Source-of-truth relationships

- `product-spec.md` remains authoritative for the current Monitor product boundary.
- this document is authoritative for Explorer v1 and Explorer v2 scope and sequencing requirements;
- `observatory-roadmap.md` defines the approved implementation order from Monitor completion through Observatory expansion;
- `development-roadmap.md` remains authoritative for the active M0-M6 release work until reconciled as implementation units advance;
- UI information architecture, page map, design, component, and responsive specifications remain authoritative for presentation behavior;
- `resource-envelope.md` remains authoritative for measurable runtime and storage safety gates.
