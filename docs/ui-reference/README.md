# UI reference interpretation

## Purpose

This directory records how the approved XRPL Lending Monitor mockup set should be interpreted during implementation. The mockups are visual references, not data fixtures, API contracts, or permission to invent features.

## Approved reference set

The approved direction includes reference screens for:

- desktop Overview;
- desktop Loan list;
- desktop Loan detail;
- desktop Loan Broker detail;
- desktop Activity;
- desktop Archived Loan / Lifecycle Audit;
- mobile Overview;
- mobile Loan detail.

The repository does not need to store generated image binaries to preserve the design contract. The durable requirements are written in the UI specification documents.

## Adopted elements

Implementations should adopt:

- dark navy to near-black ledger-observatory appearance;
- cyan primary accent;
- restrained factual status colors;
- desktop left sidebar;
- persistent network context bar;
- compact metric and health cards;
- high-density but grouped tables;
- monospace identifiers and hashes;
- summary-first entity pages;
- related-entity panels;
- lifecycle timelines and before/after panels;
- archive banners and final-state context;
- separate desktop and mobile information priority;
- visible provenance and unavailable states.

## Elements that are not approved as facts

Do not copy from the mockups:

- example counts;
- example addresses, IDs, hashes, ledgers, dates, or transaction types;
- USD values or fiat conversions;
- oracle or DEX pricing statements;
- cross-asset totals;
- peer counts, uptime, error rates, or health metrics not exposed by the API;
- unsupported status names;
- unsupported charts or time series;
- invented archive reasons;
- version numbers;
- links to routes or explorers that are not configured.

## Data authority

The authority order for displayed values is:

1. approved API contract and runtime response;
2. product, data, status, and asset specifications;
3. UI page and component specifications;
4. mockup layout reference.

When a mockup conflicts with an API or specification, the mockup loses.

## Visual authority

The authority order for visual behavior is:

1. `ui-design-spec.md`;
2. `ui-information-architecture.md`;
3. `ui-page-specifications.md`;
4. `ui-component-inventory.md`;
5. `ui-responsive-rules.md`;
6. mockup reference.

## Overview reference interpretation

Approved:

- sidebar and context bar;
- counts and active-snapshot availability;
- collector and amendment panels;
- recent activity;
- Devnet epoch/reset notice;
- provenance legend.

Not approved without data support:

- fiat exposure;
- combined asset totals;
- cover/debt chart;
- peer count or uptime.

## Loan list reference interpretation

Approved:

- bounded filter toolbar;
- separate on-ledger and schedule states;
- dense sortable table;
- selected-row summary where useful;
- clear pagination and freshness.

Not approved:

- fiat columns;
- unsupported state labels;
- fake totals or page counts.

## Loan detail reference interpretation

Approved:

- summary header;
- tab set;
- key balances and schedule facts;
- lifecycle, payments, state changes, transactions, related entities, and raw data;
- responsive mobile priority.

Not approved:

- inferred health or cover score;
- fiat values;
- events absent from canonical history.

## Loan Broker detail reference interpretation

Approved:

- debt, cover, required-cover, and surplus/shortfall presentation;
- related Vault;
- Loan book;
- Broker activity;
- debt and cover history when API-supported.

Not approved:

- fiat conversion;
- unsupported reserve or liquidation fields;
- proprietary health classification.

## Activity reference interpretation

Approved:

- filters;
- normalized activity table;
- selected transaction inspection;
- affected objects and before/after changes;
- provenance and export access.

Not approved:

- fabricated activity-volume chart;
- event classification not present in the API.

## Archive reference interpretation

Approved:

- prominent archive banner;
- lifecycle timeline;
- final state;
- deletion evidence;
- before/after or removed-field representation;
- archive metadata;
- source transactions;
- raw archive data where retained.

Not approved:

- guessed deletion reason;
- immutable-storage claims not established by architecture;
- fake snapshot identifiers.

## Mobile reference interpretation

Approved:

- mobile app bar;
- compact network context;
- bottom navigation;
- one-column information flow;
- summary-first entity detail;
- vertical lifecycle timeline;
- stacked related entities.

The mobile implementation must follow `ui-responsive-rules.md`, not merely imitate the dimensions of one generated image.

## Implementation review checklist

Before calling a page visually complete, verify:

- it follows the approved visual tokens;
- it uses real API-supported values;
- it has loading, empty, unavailable, stale, partial, and error behavior as applicable;
- it exposes network, epoch, freshness, and provenance;
- it does not add pricing or cross-asset aggregation;
- it works with keyboard, zoom, long identifiers, and the defined mobile layout;
- it matches the page responsibility in `ui-page-specifications.md`.
