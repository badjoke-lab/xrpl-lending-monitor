# UI page specifications

## Purpose

This document defines responsibility, required content, API dependency, unavailable behavior, navigation, and milestone assignment for every public page. It complements `product-spec.md` and `explorer-spec.md` and does not weaken data, status, asset, provenance, or release requirements.

## Common requirements

Every Explore, monitoring, or audit page must:

- show Devnet, epoch, validated-ledger, freshness, and collector context where available;
- distinguish current, historical, archived, stale, empty, unavailable, partial, and error states;
- preserve XRP, IOU, and MPT identity without unsupported aggregation;
- keep on-ledger status separate from schedule status;
- identify Direct, Derived, Indexed, and Unavailable data;
- provide shareable routes for filters, pagination, selected entities, and meaningful subviews where practical;
- use only approved read-only API data;
- avoid wallet, funding, transfer, signing, deposit, borrowing, repayment, and administration affordances.

## Overview — `/`

### Purpose

Provide a fast, trustworthy technical summary of protocol availability and current monitoring state, then route users to detailed pages and the guided Explore surface.

### Required content

- Devnet and epoch context;
- amendment status;
- latest validated ledger and age;
- last processed ledger, collector status, lag, and last success;
- current Vault, Loan Broker, Loan, and current-object counts when an active snapshot exists;
- explicit unavailable explanation before snapshot activation;
- recent protocol activity preview;
- stale, collector-error, and reset notices;
- provenance legend;
- links to Explore after E1 navigation integration and to Vaults, Loan Brokers, Loans, Activity, Network Status, and Methodology.

### Prohibited content

- cross-asset totals;
- unsupported fiat estimates;
- unsupported charts;
- fabricated zeros for unavailable counts;
- implied investment or safety conclusions.

### API dependencies

`/api/status`, `/api/overview`, and bounded `/api/activity`.

### Milestone

M4-1, complete. Explore transition link is added during E1.

## XRPL Lending Explorer — `/explore`

### Purpose

Provide a beginner-oriented guided view of how observed Vaults, Loan Brokers, Loans, and protocol activity relate without replacing the technical Monitor or Audit surfaces.

### Required content

- Devnet, read-only, and freshness context;
- concise scope statement and transition to technical Overview;
- conceptual Vault -> Loan Broker -> Loan -> payment/management flow explanation;
- bounded current summary cards from approved contracts;
- bounded observed relationship view with accessible list or text alternative;
- human-readable Loan cards that preserve separate on-ledger and schedule states;
- recent Activity translation that retains canonical transaction type, result, ledger, hash, affected objects, and provenance;
- compact glossary for Vault, Loan Broker, Loan, current state, indexed history, status separation, and provenance categories;
- links to canonical technical Vault, Loan Broker, Loan, Activity, transaction, Audit, and Methodology routes as applicable;
- explicit stale, partial, unavailable, empty, and error behavior.

### Required behavior

- use bounded initial requests;
- lazy-load selected detail;
- avoid page-load N+1 detail requests;
- preserve same-network and same-epoch relationship context;
- visually distinguish conceptual protocol flow from actually observed object relationships;
- preserve complete identifier access when values are visually shortened;
- expose technical evidence rather than replacing it with plain-language copy;
- keep explanation sections usable when one dynamic panel fails without implying the failed data is current or complete;
- remain fully usable with keyboard, screen reader, reduced motion, 200% zoom, reflow, and long identifiers.

### Prohibited behavior

- a separate Explorer collector;
- an Explorer-only scheduled job;
- request-time full-history scans;
- periodic page-specific D1 recomputation;
- unbounded relationship graph loading;
- unbounded historical range queries;
- protocol-wide historical trend charts that require unapproved Observatory metrics;
- global TVL, fiat valuation, cross-asset aggregation, LTV, collateral value, credit score, proprietary risk score, or investment conclusion;
- wording that changes the meaning of canonical transaction results, protocol state, schedule state, or provenance.

### API dependencies

Prefer reuse of approved bounded contracts:

- `/api/status`;
- `/api/overview`;
- bounded Vault list/detail and relationship contracts;
- bounded Loan Broker list/detail and relationship contracts;
- bounded Loan list/detail and relationship contracts;
- bounded `/api/activity`;
- exact Search or relationship contracts when needed.

A dedicated bounded Explorer composition endpoint may be added only after E1-1 measurement and contract review show that it reduces repeated reads or simplifies a stable bounded composition without weakening provenance or freshness semantics.

### Milestone

E1, after M5-5 exit and early M6 integrity/resource guardrails, before final M6 visual and release-hardening gates.

Detailed E1-1 through E1-5 sequence and completion conditions are defined in `explorer-spec.md` and `observatory-roadmap.md`.

### Explorer v2 boundary

Explorer v2 may extend the guided surface with bounded historical time series, comparisons, payment/lifecycle timelines, and relationship exploration only after O1 Observatory data contracts and the O2 Observatory monitoring view are stable.

Explorer v2 does not define metrics ad hoc. Any new metric returns to the Observatory contract process first.

## Network Status — `/network-status`

### Required content

- endpoint or server state where publicly safe;
- server version and complete-ledger range where available;
- validated ledger and age;
- collector cursor and lag;
- last attempt and success;
- consecutive failures and public-safe error;
- amendment enabled and supported states;
- epoch and reset reason;
- active snapshot identity and availability;
- stale thresholds and explanations;
- links to status API and Methodology.

### Milestone

M4-1, complete.

## Vault list — `/vaults`

### Purpose

Browse current and discoverable archived Vaults.

### Required behavior

- bounded search, cursor pagination, sorting, and supported filters;
- asset-separated exact values;
- explicit active-snapshot unavailable state;
- route to Vault detail and archive context;
- no unsupported relationship counts.

### Milestone

M4-2, complete.

## Vault detail — `/vaults/:vaultId`

### Required sections

- summary and identity;
- current fields and flags;
- asset, Share MPT, and Domain information;
- utilization and used assets with formula provenance;
- connected Loan Brokers and Loans when supported;
- activity and history when supported;
- archive context;
- raw data last.

### Milestone

M4-2 complete for verified current state; deeper audit integration remains M5.

## Loan Broker list — `/loan-brokers`

### Purpose

Compare Broker debt, capacity, cover, relationships, and factual operational states.

### Required behavior

- bounded search, sorting, and cursor pagination;
- asset-separated values;
- DebtTotal, optional DebtMaximum, and debt utilization;
- CoverAvailable, required minimum cover, and surplus or shortfall;
- formula provenance;
- same-snapshot Vault relationship;
- explicit unavailable Loan counts and status summaries until supported.

### Milestone

M4-3, complete.

## Loan Broker detail — `/loan-brokers/:brokerId`

### Required sections

- owner, pseudo-account, identifiers, status, and provenance;
- related Vault and canonical asset;
- debt, capacity, utilization, cover, configured rates, required cover, and surplus or shortfall;
- Loan book when supported;
- activity and history when supported;
- archive context;
- raw data last.

### Milestone

M4-3 complete for verified current state; deeper audit history remains M5.

## Loan list — `/loans`

### Purpose

Browse current and archived Loans without conflating protocol and schedule state.

### Required behavior

- bounded search, sorting, cursor pagination, and supported filters;
- exact asset units resolved through same-snapshot Broker and Vault relationships;
- separate on-ledger and schedule columns;
- Borrower, Broker, Vault, and asset context;
- PrincipalOutstanding, TotalValueOutstanding, PeriodicPayment, PaymentRemaining, NextPaymentDueDate, and grace context where present;
- archive lookup and relationship links;
- explicit unavailable behavior before active snapshot activation.

### API dependencies

Verified current-state Loan list reader and relationship resolver.

### Milestone

M4-4, active.

## Loan detail — `/loans/:loanId`

### Core M4-4 subviews

- Overview;
- Terms;
- Payments.

### Later audit subviews

- Lifecycle;
- State Changes;
- Transactions;
- Raw Data.

### Overview requirements

- Loan ID and Borrower;
- related Broker and Vault;
- canonical asset;
- current balances;
- separate on-ledger and schedule states;
- next payment due and grace end;
- last update, ledger, epoch, and provenance;
- related-entity links.

### Terms requirements

Display direct term, rate, interval, fee, sequence, and flag fields present in the verified Loan object. Missing or unknown fields remain explicit.

### Payments requirements

Display current schedule facts and calculated time context without inventing a complete payment history. Indexed historical payment timelines remain M5 work.

### Milestone

Overview, Terms, and core Payments in M4-4. Lifecycle, state changes, archive integration, and full raw audit work remain M5-1 and M5-2.

## Activity — `/activity`

### Required behavior

- supported transaction, result, object, account, epoch, provenance, and time filters;
- time, ledger, type, result, initiating account, affected objects, change summary, provenance, and hash;
- bounded pagination and export links;
- route to transaction detail;
- no fabricated activity-volume chart.

### Milestone

M4-5.

## Transaction detail — `/transactions/:transactionHash`

### Required content

- transaction summary;
- result, fee, sequence, time, ledger, epoch, and source;
- affected nodes;
- normalized object changes;
- related entities;
- retained raw transaction and metadata where available;
- provenance and unavailable explanations.

### Milestone

M4-5.

## Search — `/search`

### Search targets

- Vault ID;
- Loan Broker ID;
- Loan ID;
- transaction hash;
- XRPL account;
- MPT issuance ID;
- asset code or issuer pair.

### Required behavior

- validate identifiers before queries;
- group results by type;
- show current versus archived context;
- preserve network and epoch;
- distinguish no result from unavailable index.

### Milestone

M4-5.

## Account detail — `/accounts/:account`

### Required content

- owned Vaults;
- managed Loan Brokers;
- Borrower Loans;
- protocol transactions;
- archived relationships;
- no off-chain identity claims.

### Milestone

M4-5.

## Lifecycle explorer — `/audit/lifecycle`

Provides protocol-wide recorded Loan lifecycle events with supported filters, canonical ordering, provenance, and links to Loan, transaction, and archive detail. It never infers missing events.

### API dependencies

`/api/audit/lifecycle`, `/api/loans/:loanId/lifecycle`, and `/api/objects/Loan/:loanId/history`.

### Milestone

M5-1.

## Archived Objects — `/audit/archived`

Browses deleted Vault, Loan Broker, and Loan records with supported type, epoch, relationship, transaction, and classification filters. Unknown classification remains explicit.

### API dependencies

`/api/audit/archived`.

### Milestone

M5-2.

## Archived object detail — `/audit/archived/:objectType/:objectId`

### Required content

- persistent archive banner;
- final state;
- deletion event, ledger, time, and transaction;
- normalized removal representation;
- related entities and source transactions;
- archive metadata and provenance;
- retained raw archive data where available;
- current-context links where valid.

### API dependencies

`/api/audit/archived/:objectType/:objectId` and `/api/transactions/:hash`.

### Milestone

M5-2.

## Cover & Loss — `/audit/cover-loss`

### Required content

- asset-separated DebtTotal, DebtMaximum, CoverAvailable, and LossUnrealized histories;
- required minimum cover formula and inputs;
- cover surplus or shortfall;
- Broker and Vault context;
- source events and provenance;
- explicit missing-data behavior.

### Prohibited content

- cross-asset aggregation;
- fiat totals;
- proprietary risk scores;
- unsupported liquidation predictions.

### API dependencies

`/api/audit/cover-loss` and `/api/transactions/:hash`.

### Milestone

M5-3.

## Devnet Epochs — `/epochs` and `/epochs/:epochId`

Shows current and archived epochs, first and last ledger where known, reset reason, timestamps, scoped objects, activity, archives, and warnings against mixing epochs.

### API dependencies

`/api/epochs`, `/api/epochs/:epochId`, `/api/activity`, `/api/audit/archived`, `/api/audit/cover-loss`, `/api`, and `/methodology`.

### Milestone

M5-4.

## API documentation — `/api`

### Required content

- endpoint list;
- parameters, limits, sorting, pagination, network, and epoch semantics;
- clearly labelled response examples;
- provenance and unavailable states;
- export and feed formats;
- retention boundaries;
- read-only and Devnet-only status.

### Milestone

M4-6, then maintained with API changes.

## Methodology — `/methodology`

### Required sections

1. scope and principles;
2. data sources;
3. validated-ledger selection;
4. current-state bootstrap;
5. marker resume;
6. incremental collection;
7. AffectedNodes normalization;
8. asset normalization;
9. lifecycle reconstruction;
10. Loan status rules;
11. cover, debt, and loss formulas;
12. deleted-object archive;
13. Devnet epoch handling;
14. provenance categories;
15. unavailable and missing data;
16. idempotency and reconciliation;
17. storage and retention;
18. API and exports;
19. known limitations;
20. verification and release process.

The page supports stable anchors, an on-page table of contents, readable long-form layout, and source links where useful.

Explorer v1 may link to these sections but must not duplicate or replace the technical methodology. Observatory O1 and O2 work must extend Methodology when new public metrics, rollups, retention behavior, or formulas are approved.

### Milestone

M4-6, with evidence updates through M6 and later Observatory metric changes.

## About — `/about`

### Required sections

- what XRPL Lending Monitor is;
- why it exists;
- intended users;
- what it monitors;
- what differentiates its audit layer;
- Devnet-only initial scope;
- independent and read-only status;
- what Explore provides after E1 without replacing technical Monitor or Audit surfaces;
- explicit non-goals;
- repository and Methodology links;
- Contact link.

### Milestone

M4-6 baseline; Explorer description update during E1.

## Contact — `/contact`

### Required content

Two clearly separated options:

1. general or private inquiry through a configured form;
2. public technical issue, data correction, documentation issue, or feature request through GitHub Issues.

The page warns against publishing confidential or personal information in public issues. Missing external configuration produces an unavailable explanation rather than a placeholder link.

### Milestone

M4-6.

Funding, donation, payment, and promotional pages or components are outside the current release scope.

## Not found and unavailable pages

Shared handling covers:

- route not found;
- invalid identifier;
- unavailable API;
- missing active snapshot;
- stale collector;
- archived-only entity;
- unsupported data field;
- partial panel failure.

Explorer additionally requires explicit behavior when relationship seed data, one relationship branch, Activity translation data, or selected-object detail is unavailable while other page sections remain usable.

## Release completeness

A route is complete only when it has approved information architecture, required data states, responsive behavior, keyboard and screen-reader support, focused tests, API-contract alignment, no invented values, and implementation-status evidence.

Explorer v1 is additionally incomplete until request, D1-read, base-read, cache, representative interaction, graph/list accessibility, and production-shaped browser evidence satisfy the E1 completion gates.

Explorer v2 remains unavailable until O1 and O2 dependencies are satisfied.
