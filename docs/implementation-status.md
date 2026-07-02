# Implementation status

Last updated: 2026-07-02.

## Current milestone

**M1 closeout** and **M4-4 — Loan API dependency and Loan UI**.

M0, M2, M3, M4-0, M4-1, M4-2, and M4-3 are complete. M1 still requires an approved preview environment, complete bootstrap, verification, activation, rollback, cleanup, and resource evidence.

## Canonical continuation point

Latest merged work:

- PR #26: `Add Loan Broker monitor UI`;
- squash merge: `0da8174f07dc0df2464594cc284d21d9d5721861`;
- PR #27: `Align current product scope and advance M4-4`;
- squash merge: `35137cd3cfd6d4dc2113d9279bd83c9cba1a5cd7`.

Active implementation:

- branch: `api/current-state-loan-reader`;
- PR #28: `Add verified current Loan API reads`;
- first validation run identified and corrected a fixture expectation about cached relationship shards;
- corrected reader tests passed lint, type-check, unit tests, local migrations, production build, and browser tests;
- an additional Loan serialization contract test is now included and awaits the final required CI run.

## Completed in active M4-4 API unit

### Verified current-state reader

Implemented:

- bounded opaque-cursor Loan pagination;
- ascending and descending Loan ID ordering;
- factual query over Loan ID, Loan Broker ID, and Borrower;
- direct on-ledger status filtering;
- separately derived schedule-status filtering;
- bounded Loan-shard reads;
- same-snapshot Loan to Loan Broker to Vault relationship resolution;
- canonical Vault asset attached to every Loan amount;
- relationship shard caching and explicit read limits;
- fail-closed behavior for missing, inconsistent, outside-manifest, or over-limit relationships;
- digest verification through the existing manifest and shard reader.

### Status model

Implemented canonical schedule boundaries using a recorded Ripple-epoch evaluation time:

- before `NextPaymentDueDate`: `current`;
- at the due time and before due time plus grace period: `payment_due`;
- at or after due time plus grace period: `default_eligible`;
- zero remaining payments: `complete`;
- invalid or unavailable schedule inputs: `unknown`.

Schedule status never changes or replaces the direct on-ledger status.

### API routes

Implemented:

- `GET /api/loans`;
- `GET /api/loans/:loanId`.

Responses include:

- exact Loan balances, fees, rates, terms, dates, sequence, flags, and previous transaction facts;
- raw Ripple-epoch values and UTC timestamps;
- separate `on_ledger_status` and `schedule_status`;
- the fields and evaluation time used for schedule derivation;
- related Loan Broker and Vault identities;
- canonical asset identity;
- direct and derived provenance;
- explicit unavailable, invalid, not-found, and current-state integrity errors.

### Tests

Added fixture and contract coverage for:

- Loan pagination;
- cursor continuation;
- same-snapshot Broker and Vault resolution;
- canonical asset identity;
- exact due and grace boundaries;
- completed Loan schedules;
- direct detail lookup;
- relationship read limits;
- exact serialized amounts;
- independent on-ledger and schedule states;
- raw data only on detail output.

## Immediate work

1. complete the final required CI run for PR #28;
2. merge PR #28 only if all required checks pass;
3. begin the M4-4 Loan list and detail UI from the merged Loan API contract;
4. add responsive, unavailable-state, relationship-navigation, and browser coverage;
5. update this document with the exact UI branch, pull request, and validation evidence.

The first incomplete action is final validation and merge of PR #28.

## Completed M4-3 API and UI

Available API routes:

- `GET /api/loan-brokers`;
- `GET /api/loan-brokers/:brokerId`.

Available UI routes:

- `/loan-brokers`;
- `/loan-brokers/:brokerId`.

The verified read layer provides bounded cursor pagination, ID sorting, factual query, direct Broker fields, related Vault identity, canonical asset identity, exact debt and cover derivations, and fail-closed relationship behavior.

The UI provides responsive list and detail routes, direct Vault navigation, formula provenance, raw Broker data, and explicit unavailable Loan-book and history panels. PR #26 passed the full required quality workflow, including three Loan Broker browser tests.

## Known open questions

| Question | Evidence | Point |
|---|---|---|
| Failed bootstrap prefix retention | Preview cleanup and rollback measurements | M1 closeout |
| Broker and Loan shard-cap tuning | Real preview density and response measurements | M1 preview / M6 |
| Current Loan counts by Broker | Bounded aggregation or indexed relationship API | Later M4 / M5 |
| Broker and Loan history panels | Indexed history APIs and audit integration | M4-5 / M5 |
| Contact URLs | Explicit configuration approval | M4-6 |

## Active prohibitions

- no unlabeled quantity;
- no inferred impairment, default, credit, safety, or risk state;
- no schedule eligibility presented as on-ledger default;
- no cross-snapshot relationship;
- no unavailable-data-to-zero substitution;
- no USD conversion, price feed, cross-asset total, or proprietary score;
- no funding, donation, payment, or promotional surface in the current release;
- no remote infrastructure change, deployment, Mainnet, wallet, signing, transaction submission, or public write operation.

## Current blockers

No code blocker prevents completing M4-4.

Real public current-state data still requires an approved `CURRENT_STATE` binding and a complete verified active snapshot. The API and UI expose that absence explicitly.