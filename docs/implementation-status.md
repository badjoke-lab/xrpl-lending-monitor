# Implementation status

Last updated: 2026-07-02.

## Current milestone

**M1 closeout** and **M4-4 — verified Loan reader dependency**.

M0, M2, M3, M4-0, M4-1, M4-2, and M4-3 are complete. M1 still requires an approved preview environment, complete bootstrap, verification, activation, rollback, cleanup, and resource evidence.

## Canonical continuation point

Latest merged work:

- PR #26: `Add Loan Broker monitor UI`;
- squash merge: `0da8174f07dc0df2464594cc284d21d9d5721861`;
- final CI run: `28572040522`;
- result: all required `quality` checks passed.

No implementation branch remains active after PR #26.

## Immediate work

1. define the verified current-state Loan list and detail read contract;
2. implement bounded Loan shard reads and same-snapshot Loan Broker and Vault relationship resolution;
3. expose Loan list and detail API routes with exact asset values, separate on-ledger and schedule states, and explicit unavailable behavior;
4. implement and validate the M4-4 Loan list and detail UI after the reader dependency is complete.

The first incomplete action is the M4-4 current-state Loan reader contract and dependency review.

## Completed M4-3 API and UI

Available API routes:

- `GET /api/loan-brokers`;
- `GET /api/loan-brokers/:brokerId`.

Available UI routes:

- `/loan-brokers`;
- `/loan-brokers/:brokerId`.

The verified read layer provides bounded cursor pagination, ID sorting, factual query, direct Broker fields, related Vault identity, canonical asset identity, and exact debt and cover derivations.

Every Broker quantity is paired with the related Vault asset in the same active snapshot. Missing, inconsistent, or over-limit relationships fail closed. Without an active snapshot or storage binding, the API and UI return explicit unavailable state.

### Loan Broker list

Implemented:

- active desktop sidebar and mobile More navigation;
- factual search over Broker ID, Vault ID, owner, and pseudo-account;
- Broker ID ascending and descending order;
- bounded opaque-cursor Previous and Next navigation;
- active snapshot and ledger context;
- Broker ID, owner, and canonical related-Vault asset;
- DebtTotal and optional DebtMaximum;
- debt utilization;
- CoverAvailable;
- required minimum cover;
- cover surplus or explicit shortfall;
- direct related Vault navigation;
- Broker-shard, relationship-shard, and object-examination counts;
- loading, empty, unavailable, and request-error states;
- no inferred Loan count, impairment state, risk score, fiat value, or cross-asset total.

### Loan Broker detail

Implemented:

- 64-character hexadecimal route matching;
- breadcrumbs and active navigation;
- asset, debt utilization, available cover, and surplus or shortfall summary cards;
- direct owner, pseudo-account, sequences, owner count, management fee rate, flags, previous transaction, and previous ledger fields;
- exact debt, maximum debt, cover, required cover, surplus or shortfall, and cover-ratio values;
- minimum and liquidation cover-rate facts;
- formulas and derived provenance;
- direct related Vault card and navigation;
- explicit unavailable Loan book and history panel rather than inferred counts or states;
- raw decoded Broker object after the human-readable summary.

### Responsive and shared behavior

Implemented:

- desktop filter grid and wide Broker table;
- tablet filter and summary-card reflow;
- mobile single-column filters and summary cards;
- dedicated table overflow rather than page-level horizontal scrolling;
- shortfall-specific factual warning treatment with text labels;
- related Vault card reflow;
- Loan Broker API response types;
- list and detail routes in the existing History API router;
- active sidebar state for Broker detail routes;
- dedicated Broker stylesheet.

## M4-3 validation

PR #26 passed:

- dependency installation;
- lint;
- TypeScript type-check;
- full unit test suite;
- all local D1 migrations;
- production build;
- Chromium installation;
- all existing Overview, Network Status, and Vault browser tests;
- three Loan Broker browser tests.

The browser tests cover:

1. available Broker collection, exact debt and cover facts, absence of USD output, detail navigation, raw data, direct Vault link, and explicit Loan book/history unavailability;
2. missing-snapshot unavailable state and factual query/order request parameters;
3. narrow mobile layout and Loan Broker navigation through the More menu.

No collector, migration, Cloudflare configuration, remote resource, deployment, Mainnet, wallet, signing, transaction submission, or public-write behavior changed in PR #26.

## Known open questions

| Question | Evidence | Point |
|---|---|---|
| Failed bootstrap prefix retention | Preview cleanup and rollback measurements | M1 closeout |
| Broker shard-cap tuning | Real preview density and response measurements | M1 preview / M6 |
| Current Loan counts by Broker | Verified Loan reader and bounded relationship resolution | M4-4 |
| Broker activity and history panels | Indexed history APIs and M5 audit integration | M4-5 / M5 |
| Contact URLs | Explicit configuration approval | M4-6 |

## Active prohibitions

- no unlabeled quantity;
- no inferred Loan count, impairment, default, or risk state;
- no cross-snapshot relationship;
- no unavailable-data-to-zero substitution;
- no USD conversion, price feed, cross-asset total, or proprietary risk score;
- no remote infrastructure change, deployment, Mainnet, wallet, signing, transaction submission, or public write operation.

## Current blockers

No code blocker prevents beginning M4-4.

Real public current-state data still requires an approved `CURRENT_STATE` binding and a complete verified active snapshot. The UI exposes that absence explicitly.