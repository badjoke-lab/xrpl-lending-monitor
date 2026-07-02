# UI page map

## Purpose

This document defines canonical public routes, route ownership, implementation milestone, and navigation visibility. Route names are product contracts; implementation may not silently rename or collapse them without updating this document and the product specification.

## Canonical routes

| Route | Page | Group | Initial milestone | Notes |
|---|---|---|---|---|
| `/` | Overview | Monitor | M4 | Main entry point |
| `/vaults` | Vault list | Monitor | M4 | Search, filters, sorting, pagination |
| `/vaults/:vaultId` | Vault detail | Monitor | M4 | Current or archived-context links |
| `/loan-brokers` | Loan Broker list | Monitor | M4 | Debt and cover summary |
| `/loan-brokers/:brokerId` | Loan Broker detail | Monitor | M4 | Related Vault and Loan book |
| `/loans` | Loan list | Monitor | M4 | Current and archived lookup |
| `/loans/:loanId` | Loan detail | Monitor | M4 | Tabbed detail surface |
| `/activity` | Protocol activity | Monitor | M4 | Normalized protocol transactions |
| `/transactions/:transactionHash` | Transaction detail | Monitor | M4 | Affected nodes and normalized changes |
| `/search` | Global search | Monitor | M4 | Identifier, account, asset, and transaction search |
| `/accounts/:account` | Account detail | Monitor | M4 | Protocol relationships only |
| `/audit/lifecycle` | Lifecycle explorer | Audit | M5 | Cross-Loan lifecycle events |
| `/audit/archived` | Archived Objects explorer | Audit | M5 | Vault, Loan Broker, and Loan archives |
| `/audit/archived/:objectType/:objectId` | Archived object detail | Audit | M5 | Final state and deletion evidence |
| `/audit/cover-loss` | Cover & Loss audit | Audit | M5 | Asset-separated debt, cover, and loss history |
| `/epochs` | Devnet Epoch list | Audit | M5 | Current and archived epochs |
| `/epochs/:epochId` | Devnet Epoch detail | Audit | M5 | Epoch-scoped objects and activity |
| `/network-status` | Network Status | System | M4 | Collector and network operations |
| `/api` | API documentation | System | M4 | Human-readable API reference |
| `/methodology` | Methodology | System | M4 | Full technical methodology |
| `/about` | About | Project | M4 | Project purpose and boundaries |
| `/contact` | Contact | Project | M4 | Google Form and GitHub Issues choices |
| `/about#support` | Support section | Project | M4 optional | Enabled only after explicit configuration approval |

## Loan detail subviews

The canonical Loan detail route is `/loans/:loanId`. Subviews may use route segments or query-backed tabs, but the user-facing tab set is fixed:

- Overview;
- Terms;
- Payments;
- Lifecycle;
- State Changes;
- Transactions;
- Raw Data.

A direct link to a subview must remain shareable and restore the selected tab.

Recommended route shape:

```text
/loans/:loanId
/loans/:loanId/terms
/loans/:loanId/payments
/loans/:loanId/lifecycle
/loans/:loanId/state-changes
/loans/:loanId/transactions
/loans/:loanId/raw
```

The final implementation may use equivalent canonical query parameters only if browser navigation, deep linking, accessibility, and static deployment behavior remain correct.

## Vault detail sections

The canonical Vault detail page includes:

- Overview;
- Loan Brokers;
- Loans;
- Activity;
- History;
- Raw Data.

Separate route segments are optional. Deep links to meaningful sections are required.

## Loan Broker detail sections

The canonical Loan Broker detail page includes:

- Overview;
- Loan Book;
- Debt & Cover;
- Activity;
- History;
- Raw Data.

Separate route segments are optional. Deep links to meaningful sections are required.

## Documentation anchors

Methodology and API documentation use stable section anchors.

Examples:

```text
/methodology#validated-ledgers
/methodology#bootstrap
/methodology#affected-nodes
/methodology#lifecycle
/methodology#status
/methodology#cover-formulas
/methodology#archives
/methodology#epochs
/methodology#provenance
/methodology#limitations
/api#overview
/api#activity
/api#exports
```

Anchor changes require redirects or retained aliases after public release.

## Contact and support external links

The following are configuration-backed, not hard-coded product routes:

- Google Form URL;
- GitHub Issues URL or issue-template URLs;
- repository URL;
- XRPL Explorer links;
- approved support address URI and QR payload.

A missing configuration value results in an explicit unavailable or omitted control, never a placeholder destination.

## Route context requirements

Every data route must preserve or display:

- network;
- epoch;
- freshness;
- current versus archived context;
- unavailable or stale state when applicable.

Filters and pagination should be reflected in the URL where practical so views are shareable and browser navigation is predictable.

## Not-found and invalid-route behavior

The application must provide:

- a general not-found page;
- invalid identifier handling;
- unsupported object-type handling;
- archived-object redirection or cross-linking when an object is absent from current state but present in archives;
- no automatic fallback from an invalid Mainnet-like request to Devnet data.

## Initial navigation visibility

Routes may be hidden until their implementation unit is merged. The route map still remains authoritative. A hidden route is not removed from the roadmap.

The Support item is the only planned route-level item that remains optional. It is hidden until the approved address and disclosures are present.
