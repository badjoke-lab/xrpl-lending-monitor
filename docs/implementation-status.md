# Implementation status

Last updated: 2026-07-02.

## Current milestone

**M1 closeout** and **M4-3 dependency — current Loan Broker API**.

M0, M2, M3, M4-0, M4-1, and M4-2 are complete. M1 still requires an approved preview environment, complete bootstrap, verification, activation, rollback, cleanup, and resource evidence.

## Canonical continuation point

Latest merged UI work:

- PR #24: `Add Vault list and detail UI`;
- squash merge: `189107d04ea94774b73d60e04a5635795a1f0f5c`.

Active work:

- PR #25: `Add verified Loan Broker API reads`;
- branch: `api/current-state-loan-broker-reader`;
- base: `189107d04ea94774b73d60e04a5635795a1f0f5c`;
- validated implementation head: `06147b022484c9f3d0ab8fa32eb9ade2dd8d99ec`;
- CI run: `28569769664`;
- all `quality` steps passed.

## Immediate work

1. rerun CI for this status-only commit;
2. confirm PR #25 is mergeable and has no unresolved findings;
3. merge after the final check passes;
4. implement the Loan Broker list and detail UI from updated `main`.

## Loan Broker API implementation

Routes:

- `GET /api/loan-brokers`;
- `GET /api/loan-brokers/:brokerId`.

Collection behavior:

- limits from 1 to 100;
- snapshot-bound cursor;
- ID ascending or descending order;
- factual query across Broker ID, Vault ID, owner, and account;
- bounded Broker shard reads;
- explicit unavailable response without an active snapshot or object-storage binding.

Relationship behavior:

- the canonical asset is resolved from the referenced Vault in the same active snapshot;
- repeated Vault relationships are grouped by shard;
- shards already read during Broker scanning are reused;
- no more than eight additional relationship shards are read per request;
- missing or inconsistent relationships return an unavailable service response.

Derived fields:

- debt utilization basis points;
- required minimum cover;
- cover surplus;
- cover ratio basis points.

Calculations use exact decimal coefficients and canonical decimal formatting. Missing or invalid denominators produce unavailable derived values.

## Validation

CI run `28569769664` passed:

- install;
- lint;
- type-check;
- full unit suite;
- local D1 migrations;
- production build;
- Chromium installation;
- all existing browser tests.

Focused tests passed for cursor pagination, Vault asset resolution, shard reuse, detail lookup, relationship-read limits, exact calculations, and provenance.

The initial unit run found a formatting-only mismatch in a derived decimal. Canonical decimal normalization was added and the full suite then passed.

## Boundaries

This work does not create remote resources, modify deployment configuration, enable Mainnet, add wallet or signing behavior, or add public write operations.

Real public Broker data still requires an approved `CURRENT_STATE` binding and a complete verified active snapshot.
