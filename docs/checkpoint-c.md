# Checkpoint C — Monitoring surface baseline

Date: 2026-07-02  
Milestone: M4  
Network boundary: XRPL Lending Devnet  
Operation boundary: independent and read-only

## Decision

The M4 monitoring surface is complete at the repository level and is ready to become the baseline for later audit-depth work.

This checkpoint records implementation and automated verification only. It does not approve deployment, remote infrastructure changes, Mainnet support, wallet access, signing, transaction submission, or any public write operation.

## Included surface

### Monitor

- Overview;
- Vault collection and detail;
- Loan Broker collection and detail;
- Loan collection and detail;
- Activity;
- transaction detail;
- global exact Search;
- Account relationship detail.

### System and project

- Network Status;
- read-only API documentation;
- Methodology;
- About;
- Contact.

### Shared integration

- desktop and mobile navigation;
- route-aware semantic breadcrumbs;
- browser history and deep-link handling;
- hash-target or main-content focus restoration;
- shared Devnet, epoch, freshness, and read-only context;
- long-identifier and narrow-width containment;
- explicit current-state unavailable behavior.

## Verification matrix

| Area | Evidence | Result |
|---|---|---|
| Route integration | Browser coverage across documentation routes and shared navigation | Required routes remain reachable without full-page reload |
| Breadcrumb hierarchy | Unit and browser tests for top-level and detail routes | Current page and parent collection are exposed semantically |
| Browser history | Back navigation from an SPA route to a deep Methodology anchor | Route, hash, content, and focus are restored |
| Keyboard navigation | Skip-link browser test and post-navigation focus test | Main content can be reached without traversing the full navigation |
| Semantics | One main landmark, one page-level heading, labeled navigation regions | Baseline landmark and heading structure is retained |
| Responsive layout | 390 px route checks and horizontal-overflow assertions | Documentation routes remain contained at mobile width |
| Increased text size | 200% root text-size browser check | Primary Methodology content remains visible without page-level horizontal overflow |
| Long identifiers | Breadcrumb resolver test and containment rules | Full identifiers remain available through title metadata without forcing layout overflow |
| Shared state | Devnet, read-only, and epoch context checked before and after SPA navigation | Context remains consistent across pages |
| Unsupported controls | Browser regression over interactive controls and explicit control selectors | No wallet, signing, transaction submission, payment, donation, USD-total, or risk-score control is exposed |
| Quality gate | Repository CI | Lint, type-check, unit tests, local D1 migrations, build, Chromium installation, and browser tests must all pass before merge |

## Data and interpretation boundaries

- Current Vault, Loan Broker, and Loan state is public only when one complete verified active snapshot and the approved `CURRENT_STATE` binding are both available.
- Missing current state remains unavailable; it is not converted to an empty collection or zero.
- Direct on-ledger state, derived schedule state, indexed history, and unavailable data remain separately labeled.
- Relationships are resolved only inside their disclosed snapshot or indexed evidence context.
- No off-chain identity, affiliation, credit, safety, impairment, default, or risk conclusion is inferred.
- No USD conversion, price feed, cross-asset total, or proprietary score is introduced.

## Deferred beyond M4

- deeper lifecycle and archived-object audit views;
- full Loan Broker and Loan history panels;
- bounded relationship aggregation not already supported by the current API;
- approved preview bootstrap, activation, rollback, cleanup, and resource evidence required for M1 closeout;
- any deployment or Mainnet decision.

## Continuation point

M5 may extend audit depth from this baseline without weakening the M4 availability, provenance, epoch, read-only, navigation, accessibility, or unsupported-control boundaries recorded here.
