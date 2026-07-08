# Decision log

Public decisions are recorded in the product, architecture, roadmap, and implementation-status documents.

This file records concise public architecture and product decisions that materially constrain later implementation.

## D-014 — Canonical asset identity and exact arithmetic

- Date: 2026-07-01
- Status: accepted

### Decision

Canonical asset identity is `XRP`, `IOU:<currency>:<issuer>`, or `MPT:<issuance_id>`. Friendly labels, ticker symbols, names, and other metadata never replace the canonical key.

Canonical amount arithmetic uses exact integer coefficients, explicit decimal scales, and `BigInt`. Binary floating point is not used for stored or derived protocol quantities.

### Consequences

- IOUs with different issuers cannot be combined;
- MPTs with different issuance IDs cannot be combined even when their tickers match;
- XRP drops and MPT integer units are displayed using explicit scales;
- exponent-form IOU values normalize deterministically;
- aggregation fails before combining unlike asset keys;
- missing or malformed MPT metadata does not hide or alter issuance identity.

## D-015 — Complete scans activate through staged snapshots

- Date: 2026-07-01
- Status: accepted

### Decision

Vault, LoanBroker, and Loan scans are fixed to one validated ledger and written to an inactive complete-scan output. A base state becomes public only after every marker page, object normalization, relationship check, manifest check, and publication step succeeds.

### Consequences

- opaque markers are preserved exactly;
- partial scans are not exposed as current totals;
- a failed replacement does not overwrite the previous verified base;
- current-state continuation begins from the ledger after the verified base ledger;
- page, request, object, write, byte, memory, and elapsed-time measurements are recorded where applicable.

## D-016 — Terminal Loan zero fields

- Date: 2026-07-01
- Status: accepted

### Decision

Numeric Loan fields omitted by canonical XRPL binary decoding are treated as zero where the protocol uses zero defaults. `NextPaymentDueDate` is nullable because it is removed when a Loan reaches a terminal paid or defaulted state. A Loan with payments remaining but no next due date is rejected.

### Consequences

- paid and defaulted Loan objects remain visible;
- missing terminal zero fields do not fail collection;
- no timestamp is invented;
- inconsistent active schedule state still fails closed;
- raw decoded fields remain available for audit.

## D-017 — Resumable bootstrap runner

- Date: 2026-07-01
- Status: accepted

### Decision

The full current-state bootstrap uses a resumable long-running runner and one unfiltered binary ledger traversal. It produces deterministic bounded artifacts and a verified manifest. The scheduled Worker handles bounded status and incremental ledger processing after a verified base is available.

### Consequences

- repeated filtered traversals are rejected;
- full in-memory accumulation is rejected;
- production continuation remains disabled until resume, persistence, manifest, publication, and reader checks pass;
- an initial verified base is required before incremental maintenance begins.

## D-018 — Checkpoint B history boundary

- Date: 2026-07-02
- Status: accepted

### Decision

M2 history data contracts are stable enough to begin M3 public API contract implementation for current indexed data, object changes, lifecycle events, archives, balance history, and reconciliation reports.

Public lifecycle completeness claims are not yet approved. They remain gated on a verified base current state, fixture-ledger replay coverage for supported transaction shapes, contiguous incremental continuation, and later release-gate soak and reconciliation evidence.

### Consequences

- M3 API work may begin without reworking M2 table identities;
- API responses expose provenance, freshness, and unavailable or incomplete states;
- UI and public documentation do not claim complete pre-collection history;
- deleted-object, lifecycle, cover, debt, loss, and status data are exposed only as indexed data bounded by collected evidence;
- public release remains blocked until M1 continuation and M6 integrity evidence pass.

## D-019 — Ledger-observatory UI architecture

- Date: 2026-07-02
- Status: accepted

### Decision

The public interface uses a dark ledger-observatory design with a persistent desktop sidebar, mobile app bar and bottom navigation, visible Devnet, epoch, and freshness context, summary-first entity pages, monospace identifiers, and explicit loading, empty, unavailable, stale, partial, error, archived, and invalid-route states.

The approved mockup set is a visual and information-density reference only. API contracts and product specifications remain the sole authority for displayed values.

### Consequences

- the light simplified WIP shell at `ui/overview-status-shell` commit `aa623b9` is a historical checkpoint, not a merge-ready design;
- no USD conversion, oracle pricing, cross-asset total, unsupported chart, operational metric, state, or example value is copied from mockups;
- desktop and mobile behavior are separately specified and tested;
- raw data follows human-readable summaries;
- shared state components and provenance treatment are required before page expansion.

## D-020 — Project pages and external contact

- Date: 2026-07-02
- Status: accepted

### Decision

About, Methodology, Contact, and API documentation are required baseline pages.

Methodology is a separate comprehensive technical page rather than content compressed into About. Contact offers a configured Google Form for general or private inquiries and configured GitHub Issues for public technical reports and data corrections.

Funding, donation, payment, and promotional surfaces are not part of the current release scope.

### Consequences

- no placeholder form, issue, explorer, payment, or promotional URL is published;
- public-issue privacy warnings are required;
- Project navigation contains About and Contact;
- documentation and project pages remain read-only;
- later commercial or funding functionality requires a separate specification and approval.

## D-021 — D1-only current-state snapshots

- Date: 2026-07-03
- Status: superseded by D-022

### Historical decision

The evaluated design placed complete versioned current-state snapshot rows, manifests, checkpoints, activation pointers, rollback state, and public current-object reads in D1.

### Supersession reason

Measured projection for the row-per-object full current-state layout exceeded the project's documented storage safety envelope. The design was therefore stopped before remote current-state migration and replaced by D-022. The evaluation remains documented because it established useful retention, integrity, resume, and resource evidence.

### Retained guarantees

D-022 preserves the guarantees that matter:

- one fixed validated ledger identity per complete bootstrap;
- exact marker continuation;
- deterministic normalization and hashing;
- complete manifest verification;
- relationship checks;
- fail-closed replacement behavior;
- bounded work;
- explicit freshness and availability states.

## D-022 — Verified base read model with D1 incremental overlay

- Date: 2026-07-04
- Status: accepted

### Decision

Current state uses two coordinated public data layers:

1. a complete immutable verified base read model produced from one fixed validated Devnet ledger; and
2. bounded D1 incremental history and current-state overlay records applied from the ledger immediately after the base ledger.

The public API resolves current objects deterministically:

- an overlay upsert overrides the base object;
- a deletion tombstone hides the base object from current routes;
- an object with no overlay record falls back to the verified base.

Incremental history, lifecycle, archive, balance, overlay, and cursor changes share the documented canonical persistence boundary. The interface exposes base identity, collector cursor, overlay watermark, actual freshness, and stale or gap states.

### Consequences

- complete base objects are not duplicated into D1;
- D1 stores network and epoch state, cursors, processed ledgers, normalized events, object changes, lifecycle data, archives, balance history, bounded current overlays, tombstones, aggregates, and operational state;
- current-state pages can continue changing between complete base replacements;
- a failed incremental run does not advance the canonical cursor;
- a base identity mismatch fails closed;
- a stale or interrupted continuation path is not presented as fresh;
- complete base replacement remains an explicit verified process rather than page traffic or a public write route;
- periodic reconciliation checks base identity, overlay deltas, relationships, counts, cursor continuity, and archived/current separation;
- Mainnet remains disabled until separately approved.

## D-023 — Explorer-first presentation layer and Observatory sequence

- Date: 2026-07-08
- Status: accepted

### Decision

The project adopts the following product-evolution order:

```text
XRPL Lending Monitor
  -> Explorer v1
  -> XRPL Lending Observatory data foundation
  -> Observatory monitoring view
  -> Explorer v2
```

Explorer v1 is a bounded guided presentation layer over approved Monitor APIs and current/history contracts. It is scheduled after M5-5 and early M6 resource guardrails, but before the final M6 visual and release-hardening passes so it can be included in those gates.

The XRPL Lending Observatory expansion begins only after the stable Monitor release boundary and real soak evidence. Observatory work begins with data contracts, incremental aggregates, retention, reset behavior, and resource measurement before trend charts or guided historical exploration.

Explorer v2 begins only after the Observatory data foundation and Observatory monitoring view establish stable bounded metric contracts and canonical technical interpretation.

### Consequences

- the canonical guided route is `/explore`;
- Explorer v1 does not add a separate collector, separate scheduled job, request-time full-history scan, or Explorer-specific historical analytics pipeline;
- existing Monitor and Audit pages remain first-class technical surfaces and are not replaced by Explorer;
- Explorer v1 focuses on protocol flow, bounded current summaries, bounded relationships, human-readable Loan cards, Activity translation, glossary, and transitions to technical evidence;
- free-tier operation remains a design target enforced through measured request, D1-read, D1-write, base-read, cache, storage-growth, and retention evidence;
- Observatory metrics must define source, formula or event derivation, provenance, asset scope, observation-window boundary, retention, reset behavior, replay behavior, resource cost, API contract, and reconciliation before publication;
- one approved Observatory metric contract should support both the technical Observatory monitoring view and Explorer v2 where practical;
- Explorer v2 does not invent metrics ad hoc;
- repository contributors and automation must re-read `explorer-spec.md` and `observatory-roadmap.md` with the active roadmap, implementation status, resource envelope, and affected UI/data specifications before Explorer or Observatory implementation work.

## D-024 — Explorer v1 Guided Dashboard + Relationship Explorer direction

- Date: 2026-07-08
- Status: accepted

### Decision

Explorer v1 adopts a **Guided Dashboard + Relationship Explorer hybrid** visual and information architecture.

The page teaches the three primary concepts first, shows bounded current facts second, explains the conceptual Vault -> Loan Broker -> Loan flow, then presents a bounded observed relationship view, a readable selected-Loan summary, recent Activity translation, glossary/help, and transitions to canonical technical evidence.

Explorer remains visually part of the current XRPL Lending Monitor application. The Hero uses restrained dark application styling and must not use lighthouse, observatory-building, scenic landscape, or decorative architectural illustration.

Pre-entry design preparation may document visual composition, contract mapping, translation rules, relationship loading principles, accessibility alternatives, and measurement hooks before the E1 start gate. It does not start E1 implementation or authorize routes, runtime fetching, endpoints, persistence, or budgets.

### Consequences

- the approved visual direction is recorded in `explorer-v1-visual-direction.md`;
- planned sections are mapped in `explorer-v1-contract-matrix.md`;
- plain-language concept, field, status, and Activity wording is prepared in `explorer-v1-translation-dictionary.md` and must be revalidated against actual API/event semantics before implementation;
- bounded relationship behavior is prepared in `explorer-v1-relationship-contract.md` and must be finalized with M6 resource evidence;
- the relationship view is the primary project-specific Explorer visual feature but remains bounded, same-context, progressively loaded, and accessible;
- conceptual flow and observed relationships are visually distinct;
- page-load N+1 detail fetching remains prohibited;
- unsupported values from mockups remain prohibited, including TVL, fiat values, APR/APY, unsupported 24-hour changes, cross-asset totals, LTV, collateral value, health gauges, liquidation-risk visuals, and credit/risk scores;
- the start gate remains unchanged: M5-5 exit, M6 integrity/reset baseline, and M6 runtime/resource guardrails must precede E1-1 implementation.
