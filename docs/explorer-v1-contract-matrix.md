# Explorer v1 contract matrix

Last updated: 2026-07-08.

## Purpose

This document records the approved pre-entry contract mapping for the Explorer v1 visual direction.

It does not start E1-1 implementation and does not override the Explorer start gate. The active dependency order remains:

```text
M5-5 exit
  -> M6 integrity/reset baseline
  -> M6 runtime/resource guardrail baseline
  -> Explorer v1 E1-1
```

The purpose of this pre-entry work is to remove ambiguity before E1-1 by mapping the approved Guided Dashboard + Relationship Explorer direction to existing verified contracts, explicit state behavior, lazy-loading boundaries, provenance, and resource measurements.

## Approved visual composition

The approved Explorer v1 direction is a hybrid of:

- **Guided Dashboard** for first-contact explanation, current bounded summaries, readable Loan information, Activity translation, glossary, and transitions to technical evidence;
- **Relationship Explorer** for a bounded observed Vault -> Loan Broker -> Loan structure view.

The page remains part of the existing XRPL Lending Monitor product. It must use the same restrained dark ledger-observatory visual identity as the current application.

The Hero must not use scenic illustration, lighthouse/observatory imagery, landscape artwork, decorative buildings, or unrelated promotional art. The Hero uses the current site's restrained technical treatment: dark application surfaces, subtle gradient or low-contrast abstract texture where useful, concise scope copy, and factual status context.

## Planned section order

```text
Hero and scope
  -> Three concepts
  -> Current snapshot
  -> Conceptual protocol flow
  -> Bounded observed relationships
  -> Selected Loan
  -> Recent Activity translation
  -> How to read this page / glossary
  -> Technical view transition
```

This order is intentional:

1. explain the vocabulary;
2. show current bounded facts;
3. explain the conceptual relationship;
4. show a bounded observed relationship sample;
5. let the user inspect one understandable Loan;
6. explain recent protocol activity;
7. provide terminology help;
8. route the user to canonical technical evidence.

## Contract matrix

### Hero and scope

| Concern | Contract |
|---|---|
| Primary question | What is this page and what boundary does it show? |
| Candidate source | `/api/status` plus `/api/overview` where needed for current network/freshness context |
| Initial load | Yes |
| Data shown | Devnet, read-only scope, freshness/collector state, concise Explorer purpose |
| Provenance | Direct status facts plus documented product copy |
| State behavior | Loading, stale, unavailable, error; explanatory copy may remain visible when dynamic status fails |
| Technical transition | Overview and Network Status |
| Resource evidence | request count, response bytes, D1/base-read evidence where measurable |

Rules:

- do not imply Mainnet availability;
- do not imply that Explorer replaces Monitor or Audit;
- do not use decorative scenic artwork;
- do not claim freshness when status evidence is unavailable.

### Three concepts

| Concern | Contract |
|---|---|
| Primary question | What are Vaults, Loan Brokers, and Loans? |
| Candidate source | documented protocol semantics; no page-specific data request required |
| Initial load | Static explanatory content |
| Data shown | concise concept definitions only |
| Provenance | Product/methodology explanation, not dynamic ledger evidence |
| State behavior | Always available; dynamic counts must not be embedded in concept copy |
| Technical transition | Vaults, Loan Brokers, Loans, Methodology |
| Resource evidence | zero API requests attributable to explanation cards |

Rules:

- concept cards explain meaning, not risk, safety, return, yield, or investment quality;
- conceptual explanation is visually distinct from observed relationship evidence.

### Current snapshot

| Concern | Contract |
|---|---|
| Primary question | What bounded current facts are available now? |
| Candidate source | `/api/overview` and `/api/status` |
| Initial load | Yes |
| Candidate cards | Vaults observed, Loan Brokers observed, Loans observed, latest validated ledger, collector freshness, bounded recent protocol activity summary if supported without extra repeated reads |
| Provenance | Direct or documented current projection according to API response |
| State behavior | unavailable counts remain unavailable, not zero; stale state remains visible; partial coverage uses partial or at-least semantics |
| Technical transition | Overview, entity lists, Network Status, Activity |
| Resource evidence | logical request count, HTTP attempts, D1 rows read where attributable, response bytes |

Prohibited cards:

- global TVL;
- cross-asset total;
- fiat value;
- APR or APY;
- LTV;
- collateral value;
- health score;
- risk grade;
- unsupported 24-hour change;
- invented sparkline or trend series.

### Conceptual protocol flow

| Concern | Contract |
|---|---|
| Primary question | How do the main object types conceptually connect? |
| Candidate source | documented protocol model; observed counts/edges are not required here |
| Initial load | Static explanatory structure |
| Data shown | Vault -> Loan Broker -> Loan -> payment/management activity |
| Provenance | Educational copy |
| State behavior | Always available; never presented as evidence that every object relationship is currently complete |
| Technical transition | Methodology and canonical entity pages |
| Resource evidence | zero API requests attributable to conceptual flow |

### Bounded observed relationships

| Concern | Contract |
|---|---|
| Primary question | What real Vault -> Loan Broker -> Loan relationships can be shown from the bounded current context? |
| Candidate source | approved bounded current list and relationship contracts; exact endpoint/query selection remains an E1-1 measurement decision |
| Initial load | bounded seed only |
| Detail load | exact selected object detail is lazy |
| Data shown | one bounded relationship sample or one selected anchor with capped related Brokers and Loans |
| Provenance | Direct current relationship evidence within the same network, epoch, and active base-plus-overlay context |
| State behavior | empty, unavailable, partial, stale, error; partial relationship coverage is explicitly labelled |
| Technical transition | canonical Vault, Loan Broker, and Loan detail routes |
| Resource evidence | seed request count, relationship query count, exact-detail interaction delta, D1 rows read, base pages/exact lookups where measurable |

The exact query plan is not finalized by this pre-entry document. E1-1 must measure whether existing bounded list/relationship contracts are sufficient or whether one bounded composition endpoint is justified.

Page-load N+1 detail fetching is prohibited.

### Selected Loan

| Concern | Contract |
|---|---|
| Primary question | What does one observed Loan mean in plain language? |
| Candidate source | exact current Loan detail contract after user selection, or one already-returned bounded Loan summary when the approved list contract contains sufficient fields |
| Initial load | no per-row detail fan-out |
| Detail load | lazy on selection where exact detail is needed |
| Candidate fields | Loan ID, on-ledger state, schedule state, canonical asset, principal outstanding, total value outstanding where useful, periodic payment, payments remaining, next payment due, grace period, related Loan Broker, related Vault, borrower account where appropriate |
| Provenance | Direct, Derived, Indexed, or Unavailable according to field contract |
| State behavior | selected object missing, archived, unavailable, stale, partial relationship context, error |
| Technical transition | Loan detail, related Broker, related Vault, transaction/history routes where supported |
| Resource evidence | request delta from selection, D1 rows read, immutable exact lookup/base read, response bytes |

Rules:

- on-ledger state and schedule state remain separate;
- visual identifier shortening never alters accessible full value;
- current schedule facts do not imply a complete historical payment timeline;
- UTC and source semantics remain explicit for dates and durations.

### Recent Activity translation

| Concern | Contract |
|---|---|
| Primary question | What happened recently, in readable language, without losing exact evidence? |
| Candidate source | bounded `/api/activity` |
| Initial load | Yes, bounded |
| Data shown | translated summary, canonical transaction type, result classification/code, ledger, hash, affected object links, provenance where available |
| Provenance | Indexed/direct according to Activity contract |
| State behavior | empty, unavailable, partial, stale, error |
| Technical transition | Activity and transaction detail |
| Resource evidence | request count, page limit, response bytes, D1 rows read where attributable |

Rules:

- non-success protocol transactions remain visible;
- unsuccessful attempts use attempt wording and never read as completed state changes;
- plain-language copy supplements rather than replaces canonical evidence.

### How to read this page / glossary

| Concern | Contract |
|---|---|
| Primary question | What do the recurring terms and provenance labels mean? |
| Candidate source | documented product/methodology semantics |
| Initial load | Static or progressively disclosed without API requests |
| Terms | Vault, Loan Broker, Loan, Lifecycle, Archived, current state, indexed history, on-ledger state, schedule state, Direct, Derived, Indexed, Unavailable |
| Provenance | Documentation copy |
| State behavior | Always available |
| Technical transition | Methodology |
| Resource evidence | zero API requests attributable to glossary content |

### Technical view transition

| Concern | Contract |
|---|---|
| Primary question | Where can the user inspect exact technical evidence? |
| Candidate source | route configuration only |
| Initial load | Static links |
| Destinations | Overview, Vaults, Loan Brokers, Loans, Activity, Lifecycle/Archive where context applies, Methodology |
| State behavior | no placeholder or dead external links |
| Resource evidence | no prefetch that causes avoidable page-load fan-out |

## Preferred initial request shape

The pre-entry preferred shape remains:

```text
page load
  -> status/overview context
  -> bounded relationship seed data
  -> bounded recent Activity

user selects object
  -> exact detail request only when needed
```

The final E1-1 plan must record the exact endpoint/query shape and measurement evidence. This document does not authorize a dedicated Explorer endpoint by default.

## Dedicated composition endpoint decision rule

Default decision: reuse existing approved bounded endpoints.

A dedicated Explorer composition endpoint may be proposed only when measured evidence shows that it:

- reduces repeated server work or browser request fan-out;
- remains bounded by explicit limits;
- preserves network, epoch, base, cursor, freshness, asset, and provenance semantics;
- has explicit loading/empty/unavailable/stale/partial/error behavior;
- does not perform request-time full-history aggregation;
- does not become Explorer-only scheduled persistence.

Convenience alone is not sufficient justification.

## Pre-entry completion condition

This matrix is ready for E1-1 review when:

- every planned section has a candidate source and state model;
- no section depends on unsupported financial analytics;
- initial versus lazy loading is explicit;
- relationship loading remains bounded;
- technical evidence remains reachable;
- measurement hooks are identified;
- unresolved endpoint choices are clearly deferred to measured E1-1 review rather than hidden as implementation assumptions.
