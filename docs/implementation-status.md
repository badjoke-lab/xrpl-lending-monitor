# Implementation status

Last updated: 2026-07-02.

## Current milestone

**M1 closeout** and **M4-5 — Activity, Transaction, Search, and Account UI**.

M0, M2, M3, M4-0, M4-1, M4-2, M4-3, and M4-4 are complete. M4-5a is merged. M4-5b is active. M1 still requires an approved isolated preview environment, complete bootstrap, verification, activation, rollback, cleanup, and resource evidence.

## Canonical continuation point

Latest merged work:

- PR #28: `Add verified current Loan API reads`;
- squash merge: `3b9bc33b69f4e0648176353139a4d38100bcf69b`;
- PR #29: `Add current Loan monitor UI`;
- squash merge: `e29a7a826562f449edb656aa7f245135f69bb2a8`;
- PR #31: `Add Activity and transaction monitoring`;
- squash merge: `541650294a2dea04ff72b96a7258b9ea6f583f3c`.

Active implementation:

- branch: `ui/search-account-monitor`;
- milestone unit: M4-5b;
- routes: `/search` and `/accounts/:account`;
- validation: pending CI.

## Completed M4-4

### Verified Loan API

Available routes:

- `GET /api/loans`;
- `GET /api/loans/:loanId`.

The verified reader provides bounded opaque-cursor pagination, factual search and status filters, same-snapshot Loan to Loan Broker to Vault resolution, canonical asset identity, exact balances and terms, separate direct on-ledger and derived schedule states, digest verification, and fail-closed relationship behavior.

### Loan UI

Available routes:

- `/loans`;
- `/loans/:loanId`.

The UI provides responsive list and detail views, exact asset-separated values, separate on-ledger and schedule states, payment schedule facts, terms and fees, Broker and Vault links, raw current object data, and explicit unavailable history and archive states. Full lifecycle and archive audit integration remains M5 work.

## Completed M4-5a

Available routes:

- `/activity`;
- `/transactions/:transactionHash`.

Delivered:

- bounded Activity browsing over the latest 100-event API window;
- transaction hash, type, result, epoch, and UTC filters;
- URL-backed filter state and client-side pagination;
- export and feed links;
- transaction summary, affected nodes, normalized object changes, relationship links, provenance, and retained raw payloads;
- centralized monitoring router and responsive Activity navigation.

PR #31 passed lint, type-check, unit tests, local D1 migrations, production build, Chromium setup, and browser smoke tests before merge.

## Active M4-5b

Implemented on the active branch:

- `/search` exact-match global Search page;
- query validation for empty, oversized, malformed account-shaped, malformed 64-character, and control-character input;
- grouped transaction, object-change, archived-object, and Loan-lifecycle results;
- current versus archived labels;
- direct routes to current entity or transaction detail when supported;
- `/accounts/:account` protocol relationship page;
- separate current snapshot and indexed/archive relationship sections;
- current Vault owner or pseudo-account matches;
- current Loan Broker owner or pseudo-account matches;
- current Borrower Loan matches;
- indexed protocol transactions and historical/archive object relationships;
- explicit no-off-chain-identity boundary;
- malformed-account fail-fast behavior without API requests;
- desktop and mobile Search navigation;
- SPA query-string and anchor preservation;
- focused Search and Account browser tests.

The first incomplete action is CI validation of the active branch, followed by correction of any failures and merge only after all required checks pass.

## Next M4 units

### M4-6 — Project and data documentation pages

Required routes:

- `/about`;
- `/methodology`;
- `/contact`;
- `/api`.

The Contact page must expose only configured external destinations. Missing configuration must remain explicit and no placeholder external URL may be published.

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
| Contact form URL | Explicit configuration approval | M4-6 / M6 |

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
