# UI responsive rules

## Purpose

This document defines how XRPL Lending Monitor adapts across desktop, tablet, mobile, zoomed, and long-content conditions. Responsive behavior is part of page completeness.

## Behavior bands

- **wide desktop** — persistent sidebar, full context bar, multi-column dashboards, wide tables;
- **compact desktop or tablet landscape** — reduced sidebar, condensed context, fewer columns;
- **tablet portrait** — drawer navigation, one or two columns, table simplification;
- **mobile** — compact app bar, bottom navigation, one-column content, mobile-specific information priority.

Exact breakpoints may be refined after browser testing. Behavior must not depend on named devices alone.

## Wide desktop

- persistent left sidebar;
- full network context bar;
- bounded metric and health grids;
- optional related-information rail on entity details;
- full semantic tables where usable;
- constrained documentation text width and optional sticky contents.

## Compact desktop and tablet

- sidebar may reduce or become a drawer without losing labels or keyboard clarity;
- context may wrap or collapse into a summary;
- summary cards reduce columns;
- detail rails move below primary content;
- filter controls wrap without changing meaning;
- wide tables use priority columns and row expansion.

## Mobile application frame

### App bar

Contains the supported subset of:

- menu or back control;
- product or page title;
- DEVNET indicator;
- freshness or collector indicator;
- context expansion.

### Bottom navigation

Primary items:

- Overview;
- Loans;
- Activity;
- Search;
- More.

It respects safe-area insets and does not cover page actions or pagination.

### More menu

Contains available or clearly planned routes from:

- Vaults;
- Loan Brokers;
- Lifecycle;
- Archived Objects;
- Cover & Loss;
- Devnet Epochs;
- Network Status;
- API;
- Methodology;
- About;
- Contact.

## Overview

### Desktop

- bounded metric grid;
- side-by-side operational panels where space permits;
- compact recent-activity table;
- persistent provenance and Devnet notices.

### Mobile

- stacked or readable two-column metrics;
- compact operational disclosures;
- activity cards or priority-column table;
- collapsible provenance legend;
- no unsupported chart added merely to fill space.

## List pages

Every table declares priority fields.

On mobile:

- show identity, primary status, key values, and last update;
- expose remaining fields through row expansion or detail pages;
- retain filters through a sheet or dedicated region;
- keep cursor pagination reachable;
- preserve network, epoch, archive, and unavailable context.

Horizontal scrolling is reserved for raw or inherently tabular technical data, not used as the default response to narrow width.

## Entity details

### Desktop

- summary header;
- section navigation or tabs;
- primary detail column;
- optional related-entity or provenance rail.

### Mobile

- back navigation and concise identifier;
- state badges below the title;
- highest-priority facts first;
- discoverable section selector;
- related entities below primary facts;
- lifecycle and payment records as vertical lists;
- raw data last.

## Activity and transaction pages

Mobile activity cards prioritize time, transaction type, result, affected object, ledger, short hash, and provenance.

Transaction detail orders summary, affected objects, normalized changes, and raw data. Long values wrap or use dedicated overflow regions, and complete values remain copyable.

## Audit pages

- Lifecycle uses canonical order; mobile uses a vertical timeline.
- Archived pages keep the archive banner near the top.
- Cover & Loss uses one asset and unit per chart or table view.
- Epoch selection remains explicit and never relies on color alone.

## Documentation and project pages

### Desktop

- constrained reading width;
- optional sticky contents;
- stable anchor links;
- project navigation remains available.

### Mobile

- single-column reading flow;
- collapsible contents;
- linkable headings;
- dedicated overflow for code, tables, identifiers, and formulas;
- Contact cards stack.

## Contact

- general/private and public technical options appear as separate cards;
- public-disclosure warning appears before the public action;
- missing configuration disables or omits the action with a clear explanation.

## Long identifiers

- middle ellipsis may be used visually;
- the complete value remains available to assistive technology or a detail view;
- copy always uses the complete value;
- detail and documentation contexts permit wrapping;
- truncation never changes a link target.

## Zoom and reflow

At 200% zoom:

- navigation remains operable;
- content reflows without page-level two-dimensional scrolling except dedicated data regions;
- fixed headers and bottom navigation do not obscure focused content;
- dialogs fit the viewport and remain closable.

## Reduced motion

Respect `prefers-reduced-motion`. Motion is never required to understand a state change.

## Browser matrix

At minimum test:

- current Chromium desktop;
- current Firefox desktop;
- current WebKit or Safari-compatible browser;
- narrow mobile viewport;
- medium tablet viewport;
- wide desktop viewport;
- keyboard-only navigation;
- 200% zoom;
- long identifiers and error text;
- loading, empty, unavailable, stale, partial, archived, and error states.

## Completion gate

A page is responsive only when it has intentional navigation, readable information priority, usable controls and touch targets, preserved state and provenance context, an appropriate table or card strategy, tested focus order, and no hidden required information.