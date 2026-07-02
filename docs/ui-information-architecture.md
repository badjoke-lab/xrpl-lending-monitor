# UI information architecture

## Purpose

This document defines how XRPL Lending Monitor information is grouped, navigated, and linked. It is authoritative for route grouping, desktop navigation, mobile navigation, breadcrumbs, cross-page relationships, and project-page placement.

## Information groups

The application is organized into four top-level groups.

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

```text
Overview

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

- Overview remains the first and most prominent destination.
- Navigation labels must not imply unavailable routes are complete. A route may be hidden until implemented or visibly marked unavailable.
- The sidebar footer may contain repository, version, and issue-report links, but no promotional data or wallet controls.

## Top network context bar

Every monitoring and audit page shows a persistent context bar containing the supported subset of:

- network badge, initially `DEVNET`;
- epoch identifier;
- latest validated ledger;
- data age;
- collector status;
- stale or reset warning;
- current UTC time when useful.

Project and documentation pages retain a compact Devnet/read-only indicator but may reduce the full operational context when it would distract from long-form reading.

## Mobile navigation

The primary bottom navigation contains no more than five items:

```text
Overview
Loans
Activity
Search
More
```

`More` opens the remaining Monitor, Audit, System, and Project routes.

Rules:

- Vaults and Loan Brokers remain reachable within one additional action.
- Current page and current group are clear.
- The network context is condensed into the mobile app bar and an expandable status panel.

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

Breadcrumbs must use real routes and remain keyboard accessible.

## Cross-page relationships

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

### Level 1: overview and explorers

- Overview;
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
- Epoch detail.

### Level 3: focused subviews

- Loan terms;
- Loan payments;
- Loan lifecycle;
- Loan state changes;
- entity transactions;
- raw data;
- methodology anchors;
- API endpoint anchors.

## Page templates

The route system uses six reusable page types.

### Dashboard page

Overview and Network Status. Uses metric cards, health panels, notices, and activity previews.

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

The footer must not compete visually with monitoring data.