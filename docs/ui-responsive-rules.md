# UI responsive rules

## Purpose

This document defines how XRPL Lending Monitor adapts across desktop, tablet, and mobile. Responsive behavior is part of page completeness, not a later cosmetic pass.

## Breakpoint policy

Implementation may refine exact values after browser testing, but the behavior bands are:

- **wide desktop** — persistent sidebar, full top context bar, multi-column dashboards, wide tables;
- **compact desktop / tablet landscape** — persistent or collapsible sidebar, condensed context bar, reduced columns;
- **tablet portrait** — drawer navigation, two-column or single-column content, table simplification;
- **mobile** — compact app bar, bottom navigation, one-column content, mobile-specific data presentation.

Do not encode behavior only around named devices. Test narrow, medium, wide, zoomed, and long-content conditions.

## Wide desktop

- Persistent left sidebar.
- Full network context bar.
- Overview may use multiple metric and health columns.
- Entity details may use a main content column plus a related-information rail.
- List pages may use full semantic tables.
- Documentation pages retain a readable text width and optional sticky table of contents.

## Compact desktop and tablet landscape

- Sidebar may reduce width or collapse to icons only when labels remain available and keyboard use remains clear.
- Top context bar may wrap into two rows.
- Summary cards reduce column count.
- Detail rails move below primary content when horizontal room is insufficient.
- Filter controls wrap without changing meaning.

## Tablet portrait

- Navigation uses a drawer or sheet opened from the app bar.
- Network context becomes a compact summary with an expandable detail region.
- Dashboard panels become one or two columns.
- Wide tables use priority columns plus row expansion, not indiscriminate text shrinking.
- Documentation table of contents becomes collapsible.

## Mobile application frame

### App bar

The mobile app bar contains:

- menu or back control;
- product or page title;
- DEVNET indicator;
- compact freshness or collector indicator;
- optional context expansion.

### Bottom navigation

Primary items:

- Overview;
- Loans;
- Activity;
- Search;
- More.

The bottom navigation respects safe-area insets and does not cover page actions or pagination.

### More menu

Contains:

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
- Contact;
- Support when enabled.

## Overview behavior

### Desktop

- metric cards in a bounded grid;
- Network Status and amendment panels side by side where space permits;
- recent activity as a compact table;
- persistent provenance and Devnet notices.

### Mobile

- metric cards stack or form a two-column grid only when readable;
- network and collector health become compact disclosure panels;
- recent activity becomes a list of event cards or a priority-column table;
- provenance legend remains available but may collapse;
- no unsupported chart is added to fill space.

## List-page behavior

Each table defines priority fields.

### Mobile priority strategy

- show entity identity, primary status, one or two key values, and last update;
- expose remaining fields in row expansion or entity detail;
- preserve sorting and filters through a mobile filter sheet;
- keep pagination controls reachable;
- do not hide network, epoch, archive, or unavailable context.

Horizontal scrolling is acceptable for raw or inherently tabular technical data, but it is not the default solution for every list.

## Entity-detail behavior

### Desktop

- summary header;
- tabs or section navigation;
- primary detail column;
- optional related-entity or provenance rail.

### Mobile

- back navigation and concise identifier;
- state badges below the title;
- most important facts first;
- horizontally scrollable or dropdown tab selector only when all tabs remain discoverable;
- related entities below primary facts;
- lifecycle and payment records as vertical lists;
- raw data last.

## Activity and transaction behavior

### Activity mobile

Each event card prioritizes:

- time;
- transaction type;
- result;
- affected primary object;
- ledger;
- short hash;
- provenance.

Filters open in a full-height sheet or dialog and show the number of applied filters.

### Transaction detail mobile

- summary first;
- affected objects second;
- normalized changes third;
- raw transaction last;
- long values wrap or use dedicated horizontally scrollable code regions;
- copy controls remain reachable.

## Audit-page behavior

### Lifecycle

Desktop may use a horizontal or table-supported timeline. Mobile uses a vertical timeline preserving canonical order.

### Archived Objects

Archive banners remain visible near the top on all viewports. Final-state and deletion evidence stack before raw archive data.

### Cover & Loss

Charts, when supported, use one asset and one unit per view. Mobile provides a table or summarized alternative and never overlays unreadable multi-series labels.

### Epochs

Epoch selection remains explicit on every viewport. Mobile does not hide current versus archived epoch state behind color alone.

## Documentation and project pages

### Desktop

- constrained reading width;
- optional sticky table of contents;
- anchor links;
- project navigation remains available.

### Mobile

- single-column reading flow;
- collapsible table of contents;
- headings remain linkable;
- code, tables, addresses, and formulas use dedicated overflow containers;
- Contact cards stack;
- Support address and QR stack with instructions before the QR image.

## Contact behavior

- Google Form and GitHub Issue choices appear as separate cards.
- Cards stack on narrow screens.
- Public-issue privacy warning appears before the GitHub action.
- Missing external configuration disables the action and explains why.

## Support behavior

When enabled:

- address is never truncated without a full-value copy action;
- network and destination-tag instructions precede the send URI and QR code;
- QR code has a text alternative and does not replace the address;
- support links remain secondary to project information;
- no sticky donation prompt is used.

## Long identifiers

For object IDs, accounts, hashes, and issuance IDs:

- visual truncation uses middle ellipsis where appropriate;
- full value is exposed to assistive technology or a detail view;
- copy always copies the complete value;
- line wrapping is allowed in detail and documentation contexts;
- table truncation never changes the actual link target.

## Zoom and reflow

At 200% browser zoom:

- primary navigation remains operable;
- content reflows without two-dimensional page scrolling, except dedicated tables or code regions;
- fixed headers and bottom navigation do not obscure focused content;
- dialogs fit the viewport and remain closable.

## Reduced motion

Respect `prefers-reduced-motion`. Loading, navigation, disclosure, and chart transitions must not require motion to understand state changes.

## Browser test matrix

At minimum test:

- current Chromium desktop;
- current Firefox desktop;
- current WebKit/Safari-compatible browser;
- one narrow mobile viewport;
- one medium tablet viewport;
- one wide desktop viewport;
- keyboard-only navigation;
- 200% zoom;
- long identifiers and long error text;
- loading, empty, unavailable, stale, partial, archived, and error states.

## Responsive completion gate

A page is not responsive merely because it does not overflow. Completion requires:

- intentional navigation behavior;
- readable information priority;
- usable controls and touch targets;
- preserved state and provenance context;
- appropriate table or card strategy;
- tested focus order;
- no hidden required information.
