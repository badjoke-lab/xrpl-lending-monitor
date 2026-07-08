# UI information architecture

## Purpose

This document defines how XRPL Lending Monitor information is grouped, navigated, and linked. It is authoritative for route grouping, desktop navigation, mobile navigation, breadcrumbs, cross-page relationships, guided Explore placement, and project-page placement.

## Information groups

The application is organized into five top-level groups after Explorer v1 is released.

### Explore

Guided protocol understanding and bounded relationship exploration:

- XRPL Lending Explorer.

Explorer is a presentation layer over approved data contracts. It does not replace the technical Monitor or Audit surfaces.

### Monitor

Ordinary current-state and activity monitoring:

- Overview;
- Vaults;
- Loan Brokers;
- Loans;
- Activity;
- Search.

### Audit

Historical and differentiated audit surfaces:

- Lifecycle;
- Archived Objects;
- Cover & Loss;
- Devnet Epochs.

### System

Operational and machine-facing information:

- Network Status;
- API;
- Methodology.

### Project

Project identity and contact:

- About;
- Contact.

## Desktop navigation

The desktop application uses a persistent left sidebar.

After Explorer v1 navigation integration:

```text
Overview
Explore

Monitor
  Vaults
  Loan Brokers
  Loans
  Activity
  Search

Audit
  Lifecycle
  Archived Objects
  Cover & Loss
  Devnet Epochs

System
  Network Status
  API
  Methodology

Project
  About
  Contact
```

Rules:

- Overview remains the first technical summary destination.
- Explore is visually prominent and adjacent to Overview, but it does not replace Overview as the technical entry point.
- Navigation labels must not imply unavailable routes are complete. A route may be hidden until implemented or visibly marked unavailable.
- `/explore` remains hidden until the E1 navigation integration step and required bounded data/state behavior are implemented.
- The sidebar footer may contain repository, version, and issue-report links, but no promotional data or wallet controls.

## Top network context bar

Every Explore, monitoring, and audit page shows a persistent context bar containing the supported subset of:

- network badge, initially `DEVNET`;
- epoch identifier;
- latest validated ledger;
- data age;
- collector status;
- stale or reset warning;
- current UTC time when useful.

Project and documentation pages retain a compact Devnet/read-only indicator but may reduce the full operational context when it would distract from long-form reading.

## Mobile navigation

Before Explorer v1 is released, the existing baseline bottom navigation remains:

```text
Overview
Loans
Activity
Search
More
```

After Explorer v1 navigation integration, the primary bottom navigation contains no more than five items:

```text
Overview
Explore
Activity
Search
More
```

`More` opens the remaining Monitor, Audit, System, and Project routes.

Rules:

- Loans, Vaults, and Loan Brokers remain reachable within one additional action after Explorer v1 navigation integration.
- Current page and current group are clear.
- The network context is condensed into the mobile app bar and an expandable status panel.
- Explore remains reachable directly from Overview content even when mobile navigation presentation changes.

## Breadcrumbs

Use breadcrumbs on entity, transaction, archive, epoch, and documentation detail pages.

Examples:

```text
Loans / Loan <short ID>
Loan Brokers / Broker <short ID>
Activity / Transaction <short hash>
Archived Objects / Loan <short ID>
Devnet Epochs / Epoch <ID>
Methodology / Lifecycle reconstruction
```

Explorer v1 is a level-one route and does not require a breadcrumb on its root page. Later Explorer v2 subviews require shareable context and breadcrumb or equivalent accessible location cues when they become nested routes.

Breadcrumbs must use real routes and remain keyboard accessible.

## Cross-page relationships

### Explorer

Links to:

- Overview;
- selected Vault detail;
- selected Loan Broker detail;
- selected Loan detail;
- related Activity or transaction detail;
- Methodology;
- relevant Audit surfaces when indexed historical context is shown.

Explorer summaries never create duplicate canonical entity detail routes.

### Vault

Links to:

- connected Loan Brokers;
- connected Loans;
- related activity;
- history;
- archive record when deleted;
- relevant asset identity.

### Loan Broker

Links to:

- related Vault;
- Loan book;
- activity;
- debt and cover history;
- archive record when deleted.

### Loan

Links to:

- Borrower account;
- Loan Broker;
- Vault;
- lifecycle;
- payments;
- state changes;
- transactions;
- archive record when deleted.

### Transaction

Links to:

- affected Vaults;
- affected Loan Brokers;
- affected Loans;
- initiating account;
- relevant lifecycle and state-change records.

### Account

Links to:

- owned Vaults;
- managed Loan Brokers;
- Borrower Loans;
- protocol activity;
- archived relationships.

## Page hierarchy

### Level 1: overview, guided exploration, and explorers

- Overview;
- XRPL Lending Explorer;
- Vault list;
- Loan Broker list;
- Loan list;
- Activity;
- Search;
- Lifecycle explorer;
- Archived Objects explorer;
- Cover & Loss explorer;
- Devnet Epoch list;
- Network Status;
- API documentation;
- Methodology;
- About;
- Contact.

### Level 2: details

- Vault detail;
- Loan Broker detail;
- Loan detail;
- Transaction detail;
- Account detail;
- Archived object detail;
- Epoch detail;
- future bounded Explorer v2 historical subviews only after route-map approval.

### Level 3: focused subviews

- Loan terms;
- Loan payments;
- Loan lifecycle;
- Loan state changes;
- entity transactions;
- raw data;
- methodology anchors;
- API endpoint anchors;
- future Explorer v2 focused historical or comparison subviews only after O1/O2 contract approval.

## Page templates

The route system uses seven reusable page types after Explorer v1 is added.

### Dashboard page

Overview and Network Status. Uses metric cards, health panels, notices, and activity previews.

### Guided Explorer page

Explorer v1 and later Explorer v2 guided surfaces. Uses plain-language summaries, protocol flow, bounded relationship views, accessible graph/list alternatives, human-readable cards, Activity translation, glossary help, and technical-detail transitions.

The Guided Explorer page:

- loads bounded seed data;
- lazy-loads selected detail;
- never performs page-load N+1 detail fetching;
- never triggers request-time full-history scans;
- keeps canonical transaction types, results, identifiers, exact values, and provenance reachable;
- uses Observatory historical series only after O1 and O2 contracts are stable.

### List page

Vaults, Loan Brokers, Loans, Activity, Lifecycle, Archived Objects, and Epochs. Uses bounded filters, sorting, pagination, and explicit data states.

### Entity detail page

Vault, Loan Broker, Loan, Account, and archived entity pages. Uses summary header, related entities, tabs or sections, provenance, and history.

### Transaction page

Transaction detail and normalized change inspection. Uses transaction summary, affected objects, before/after changes, and raw data where retained.

### Audit page

Lifecycle, archive, cover/loss, and epoch audit surfaces. Emphasizes historical context, source transactions, provenance, formulas, and final-state retention.

### Documentation/project page

API, Methodology, About, and Contact. Uses a readable content column, section navigation, external-link treatment, and lower information density.

## Explorer and technical-surface separation

### Explorer

Explorer answers:

- what Vaults, Loan Brokers, and Loans mean in the observed system;
- how bounded observed objects relate;
- what the current observed Loan facts mean in human-readable language;
- what recent protocol activity means while preserving canonical technical evidence;
- where to continue into technical Monitor, Audit, or Methodology pages.

Explorer does not hide evidence or redefine technical status.

### Monitor

Monitor answers:

- exact current state;
- exact object fields;
- canonical identifiers and relationships;
- bounded current activity;
- technical status, freshness, and provenance.

### Audit

Audit answers:

- recorded lifecycle history;
- deleted-object evidence;
- cover, debt, and loss history;
- epoch preservation;
- provenance and historical reconstruction boundaries.

### Observatory monitoring view

The later Observatory monitoring view answers:

- how approved protocol metrics change over documented observation windows;
- how activity, debt, payments, lifecycle transitions, utilization, cover, and loss evolve when supported by stable O1 contracts.

Explorer v2 may guide general users through those established metrics but does not define them.

## About and Methodology separation

### About

About answers:

- what the project is;
- why it exists;
- who it serves;
- what it monitors;
- what it does not do;
- why it is read-only and Devnet-first;
- where to find the repository, methodology, and contact information.

### Methodology

Methodology explains technical implementation and evidence in enough detail for a developer or AI system to understand the monitoring model. It is intentionally comprehensive and may be long.

About links to Methodology rather than duplicating it.

## Contact model

Contact offers two distinct paths.

### General or private contact

An externally configured Google Form for:

- general inquiries;
- private corrections or context;
- collaboration inquiries;
- questions from people without GitHub accounts.

### Public technical contact

GitHub Issues for:

- reproducible bugs;
- data corrections supported by evidence;
- API problems;
- documentation issues;
- feature requests.

The Contact page must warn users not to place secrets, private keys, seeds, personal data, or non-public security reports in public issues.

External URLs remain configuration values. No placeholder link may be presented as operational.

## Footer

The footer may include:

- read-only and Devnet notice;
- repository;
- Methodology;
- About;
- Contact;
- issue reporting;
- version or build identifier.

The footer must not compete visually with monitoring or guided exploration data.
