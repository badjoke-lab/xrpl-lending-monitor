# Implementation status

Last updated: 2026-07-02.

## Current milestone

**M1 closeout** and **M4-3 — Loan Broker UI**.

M0, M2, M3, M4-0, M4-1, and M4-2 are complete. The verified current-state Loan Broker read dependency is also complete. M1 still requires an approved preview environment, complete bootstrap, verification, activation, rollback, cleanup, and resource evidence.

## Canonical continuation point

Latest merged dependency:

- PR #25: `Add verified Loan Broker API reads`;
- squash merge: `1051d667d87da432de1d26172fadf9fada3ae2e9`;
- final CI passed lint, type-check, full unit tests, local D1 migrations, build, and all browser regression tests.

Active M4-3 branch:

- branch: `ui/loan-broker-monitor`;
- base: `main` at `1051d667d87da432de1d26172fadf9fada3ae2e9`;
- scope: Loan Broker list, detail, Vault relationship navigation, exact debt and cover presentation, unavailable states, responsive layouts, and browser coverage.

## Immediate work

1. open the focused M4-3 pull request;
2. validate lint, type-check, unit tests, local D1 migrations, build, and all Playwright tests;
3. fix failures without inventing data or weakening asset, provenance, relationship, responsive, or accessibility rules;
4. record final evidence and merge only after required checks pass;
5. begin M4-4 verified Loan reader dependency and Loan UI from updated `main`.

The first incomplete action is opening and validating the M4-3 pull request.

## Completed API dependency

Available routes:

- `GET /api/loan-brokers`;
- `GET /api/loan-brokers/:brokerId`.

The verified read layer provides bounded cursor pagination, ID sorting, factual text query, direct Broker fields, related Vault identity, canonical asset identity, and exact debt and cover calculations.

Every Broker quantity is paired with the related Vault asset in the same active snapshot. Missing, inconsistent, or over-limit relationships fail closed. Without an active snapshot or storage binding, the API returns explicit unavailable state.

Derived fields are:

- debt utilization basis points;
- required minimum cover;
- cover surplus or shortfall;
- cover ratio basis points.

All derivations use exact decimal arithmetic and expose formulas and provenance.

## Active M4-3 implementation

### Loan Broker list — `/loan-brokers`

Implemented:

- active desktop sidebar and mobile More navigation;
- factual search over Broker ID, Vault ID, owner, and pseudo-account;
- Broker ID ascending and descending order;
- bounded opaque-cursor Previous and Next navigation;
- active snapshot and ledger context;
- Broker ID and owner;
- canonical asset inherited from the verified related Vault;
- DebtTotal and optional DebtMaximum;
- debt utilization;
- CoverAvailable;
- required minimum cover;
- cover surplus or explicit shortfall;
- direct related Vault navigation;
- Broker-shard, relationship-shard, and object-examination counts;
- loading, empty, unavailable, and request-error states;
- no Loan count, impairment state, risk score, fiat value, or cross-asset total without supporting API data.

### Loan Broker detail — `/loan-brokers/:brokerId`

Implemented:

- 64-character hexadecimal route matching;
- breadcrumbs and active navigation;
- asset, debt utilization, available cover, and surplus/shortfall summary cards;
- direct owner, pseudo-account, sequences, owner count, management fee rate, flags, previous transaction, and previous ledger fields;
- exact debt, maximum debt, cover, required cover, surplus/shortfall, and cover ratio values;
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
- shortfall-specific factual warning treatment;
- related Vault card reflow;
- Loan Broker API response types;
- list and detail routes in the existing History API router;
- active sidebar state for Broker detail routes;
- dedicated Broker stylesheet.

## Tests added

`tests/e2e/loan-brokers.spec.ts` covers:

1. available Broker collection, exact debt and cover values, absence of USD output, detail navigation, raw data, related Vault link, and explicit Loan book/history unavailability;
2. unavailable active-snapshot state and factual search/order request parameters;
3. narrow mobile layout and Loan Broker navigation through the More menu.

Final CI evidence is pending.

## Known open questions

| Question | Evidence | Point |
|---|---|---|
| Failed bootstrap prefix retention | Preview cleanup and rollback measurements | M1 closeout |
| Broker shard-cap tuning | Real preview density and response measurements | M1 preview / M6 |
| Current Loan counts by Broker | Verified Loan reader and bounded relationship resolution | M4-4 |
| Broker activity and history panels | Indexed history APIs and M5 audit integration | M4-5 / M5 |
| Contact URLs | Explicit configuration approval | M4-6 |
| Initial Support enablement | Approved payment configuration and disclosures | M4-6 / Checkpoint D |

## Active prohibitions

- no unlabeled quantity;
- no inferred Loan count, impairment, default, or risk state;
- no cross-snapshot relationship;
- no unavailable-data-to-zero substitution;
- no USD conversion, price feed, cross-asset total, or proprietary risk score;
- no remote infrastructure change, deployment, Mainnet, wallet, signing, transaction submission, or public write operation.

## Current blockers

No known code blocker prevents local and CI validation of M4-3.

Real public Broker data still requires an approved `CURRENT_STATE` binding and a complete verified active snapshot. The UI already exposes that absence as unavailable.
