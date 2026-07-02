# Implementation status

Last updated: 2026-07-02.

## Current milestone

**M1 closeout** and **M4-6 — Project and data documentation pages**.

M0, M2, M3, M4-0, M4-1, M4-2, M4-3, M4-4, and M4-5 are complete. M4-6 is active. M1 still requires an approved isolated preview environment, complete bootstrap, verification, activation, rollback, cleanup, and resource evidence.

## Canonical continuation point

Latest merged work:

- PR #29: `Add current Loan monitor UI`;
- squash merge: `e29a7a826562f449edb656aa7f245135f69bb2a8`;
- PR #31: `Add Activity and transaction monitoring`;
- squash merge: `541650294a2dea04ff72b96a7258b9ea6f583f3c`;
- PR #32: `Add global Search and Account relationship monitoring`;
- squash merge: `e92ba32ed57d9ca36f0db17793982222e3143db9`.

Active implementation:

- branch: `ui/project-documentation-pages`;
- milestone unit: M4-6;
- routes: `/about`, `/methodology`, `/contact`, and `/api`;
- validation: final CI rerun pending after the API documentation asset-route type fix.

## Completed M4-4

Available Loan API routes:

- `GET /api/loans`;
- `GET /api/loans/:loanId`.

Available Loan UI routes:

- `/loans`;
- `/loans/:loanId`.

The verified reader and UI provide bounded factual search and state filters, same-snapshot Loan to Loan Broker to Vault resolution, canonical asset identity, exact balances and terms, separate direct on-ledger and derived schedule states, responsive list and detail views, relationship links, raw current object data, and explicit unavailable history and archive states. Full lifecycle and archive audit integration remains M5 work.

## Completed M4-5

Available routes:

- `/activity`;
- `/transactions/:transactionHash`;
- `/search`;
- `/accounts/:account`.

Delivered:

- bounded Activity browsing over the latest 100-event API window;
- transaction hash, type, result, epoch, and UTC filters;
- URL-backed Activity filter state and client-side pagination;
- export and feed links;
- transaction summary, affected nodes, normalized object changes, relationship links, provenance, and retained raw payloads;
- exact indexed Search with input validation and grouped result kinds;
- explicit current versus archived context;
- protocol Account relationships separated into current snapshot and indexed/archive evidence;
- no off-chain identity or affiliation claim;
- malformed-account fail-fast behavior;
- desktop and mobile Search and Activity navigation;
- query-string and anchor preservation in SPA navigation.

PR #31 and PR #32 passed lint, type-check, unit tests, local D1 migrations, production build, Chromium setup, and browser tests before merge.

## Active M4-6

Implemented on the active branch:

- `/about` with purpose, users, scope, independence, read-only status, audit differentiation, non-goals, repository, Methodology, API, and Contact links;
- `/methodology` with a complete 20-section table of contents and stable anchors covering sources, validated ledgers, bootstrap, marker resume, collection, AffectedNodes, assets, lifecycle, status, formulas, archives, epochs, provenance, missing data, idempotency, storage, API behavior, limitations, and release verification;
- `/api` with all current public endpoints, common semantics, validation limits, pagination and cursor rules, current-state availability, history and Search behavior, exports and feeds, errors, and clearly labeled illustrative response shapes;
- `/contact` with a configured public GitHub Issues route, explicit unavailable state for the unconfigured private form, and a public-issue privacy and secret warning;
- centralized public external-link configuration;
- desktop and mobile navigation for all four routes;
- responsive long-form, table, code example, table-of-contents, and contact layouts;
- focused documentation browser tests.

No placeholder external destination is published. The first incomplete action is final CI validation and merge only after all required checks pass.

## Next M4 unit

### M4-7 — Baseline integration, accessibility, and Checkpoint C

Required completion work:

- cross-page navigation and breadcrumbs;
- browser-history and deep-link verification;
- responsive review across every M4 route;
- keyboard, focus, semantics, contrast, zoom, and long-identifier coverage;
- shared state consistency;
- regression checks prohibiting unsupported USD, pricing, cross-asset totals, risk scores, wallet, signing, or write controls;
- Checkpoint C record.

## Known open questions

| Question | Evidence | Point |
|---|---|---|
| Failed bootstrap prefix retention | Preview cleanup and rollback measurements | M1 closeout |
| Broker and Loan shard-cap tuning | Real preview density and response measurements | M1 preview / M6 |
| Current Loan counts by Broker | Bounded aggregation or indexed relationship API | M5 |
| Full Broker and Loan history panels | Indexed audit integration | M5 |
| Private contact form URL | Explicit configuration approval | M6 |

## Active prohibitions

- no unlabeled quantity;
- no inferred impairment, default, credit, safety, identity, affiliation, or risk state;
- no schedule eligibility presented as on-ledger default;
- no cross-snapshot relationship;
- no unavailable-data-to-zero substitution;
- no USD conversion, price feed, cross-asset total, or proprietary score;
- no funding, donation, payment, or promotional surface in the current release;
- no remote infrastructure change, deployment, Mainnet, wallet, signing, transaction submission, or public write operation.

## Current blockers

No code blocker prevents completing M4.

Real public current-state data still requires an approved `CURRENT_STATE` binding and a complete verified active snapshot. Current-state APIs and UI routes must continue to expose that absence explicitly.
