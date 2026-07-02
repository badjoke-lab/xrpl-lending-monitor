# Implementation status

Last updated: 2026-07-02.

## Current milestone

**M1 closeout — Current-state collector activation** and **M4-2 — Vault UI**.

M0, M2, M3, M4-0, and M4-1 are complete. The verified current-state Vault read dependency is complete. M1 still requires a complete isolated preview bootstrap, verified activation, rollback, cleanup, and resource evidence.

## Canonical continuation point

Merged dependency:

- PR #23: `Add verified current-state Vault reader`;
- squash merge: `3445d1bf86805c28ca3aa6cce2202338757106b6`;
- verified manifest/shard API, bounded cursor reads, Vault detail lookup, exact derivations, and fail-closed behavior are on `main`.

Active M4-2 work:

- PR #24: `Add Vault list and detail UI`;
- branch: `ui/vault-monitor`;
- base: `main` at `3445d1bf86805c28ca3aa6cce2202338757106b6`;
- validated implementation head before this status-only commit: `2fa5d1bfcaf2b734cc2f03e956d7ac32c4516446`;
- CI run: `28568730467`;
- result: all `quality` steps passed.

## Immediate work

1. allow CI to rerun for this validation-only status commit;
2. confirm PR #24 remains current, mergeable, and free of unresolved findings;
3. merge only after the final required check passes;
4. begin M4-3 Loan Broker verified-reader dependency and UI from updated `main`;
5. keep real preview storage binding and bootstrap activation behind the existing approval gate.

The first incomplete action is confirming the final PR #24 check and merge state.

## Completed foundations

### Current-state Vault API

The merged public read layer verifies active manifest and compressed shard metadata and content digests before exposing data. Reads are snapshot-bound, cursor-based, bounded by shard count, and fail closed on integrity errors.

Routes:

- `GET /api/vaults`;
- `GET /api/vaults/:vaultId`.

Supported collection inputs include bounded limit, opaque cursor, ID order, factual text search, and unrealized-loss filter. Detail lookup uses manifest object-index ranges to choose one candidate shard.

Exact derived fields are:

- `used_assets = AssetsTotal - AssetsAvailable`;
- `utilization_bps = floor(used_assets / AssetsTotal * 10000)`.

Without an active snapshot or storage binding, the API returns explicit unavailable state.

## M4-2 implementation

### Vault list — `/vaults`

Implemented:

- active desktop and mobile navigation;
- factual text search;
- unrealized-loss filter;
- Vault ID ascending and descending order;
- bounded opaque-cursor Next and Previous navigation;
- current snapshot and ledger context;
- Vault ID, owner, canonical asset, total, available, used, utilization, loss, and previous ledger;
- direct collection provenance;
- shard-read and object-examination counts;
- loading, empty, unavailable, and request-error states;
- direct JSON access;
- no fiat values, cross-asset totals, inferred relationships, or fabricated counts.

### Vault detail — `/vaults/:vaultId`

Implemented:

- 64-character hexadecimal route matching;
- breadcrumbs and active Vault navigation;
- asset, total, available, and utilization summary cards;
- direct owner, pseudo-account, Share MPT, Domain, withdrawal policy, scale, flags, previous transaction, and previous ledger fields;
- exact total, available, maximum, used, and unrealized-loss values;
- formula and derived provenance;
- explicit unavailable relationship panel instead of inferred Broker, Loan, activity, or history data;
- raw decoded object after the human-readable summary;
- direct API link and refresh action.

### Responsive and shared behavior

Implemented:

- desktop filter grid and table;
- tablet reflow;
- mobile single-column filters and responsive summary cards;
- dedicated table overflow rather than page overflow;
- raw-object wrapping and bounded scroll;
- generic abortable `useApiResource` hook;
- Vault API response types;
- sidebar active state for detail subroutes.

## M4-2 validation

PR #24 CI run `28568730467`, job `quality`, passed:

- dependency installation;
- lint;
- TypeScript type-check;
- full unit test suite;
- all local D1 migrations;
- production build;
- Chromium installation;
- existing Overview and Network Status browser tests;
- three new Vault browser tests.

The Vault browser tests cover:

1. available collection, exact quantities, absence of USD output, detail navigation, raw data, and explicit relationship unavailability;
2. missing-snapshot unavailable state and factual search/loss/order request parameters;
3. narrow mobile layout and Vault access through the More menu.

No collector, API, migration, Cloudflare configuration, remote resource, deployment, Mainnet, wallet, signing, transaction submission, or public-write behavior changed in PR #24.

## Known open questions

| Question | Evidence | Point |
|---|---|---|
| Failed bootstrap prefix retention | Preview cleanup and rollback measurements | M1 closeout |
| Manifest cache policy | Preview latency and request evidence | M6 |
| Public shard cap tuning | Real shard-density and response-size evidence | M1 preview / M6 |
| Connected Vault relationships | Verified Broker and Loan readers plus history queries | M4-3 to M5 |
| Contact URLs | Explicit configuration approval | M4-6 |
| Initial Support enablement | Approved payment configuration and disclosures | M4-6 / Checkpoint D |

## Active prohibitions

- generated mockup values are not facts;
- unavailable data is not zero;
- no unverified or unbounded current-state read;
- no inferred Vault relationships;
- no USD conversion, pricing oracle, cross-asset total, or proprietary risk score;
- no remote infrastructure change, deployment, Mainnet, wallet, signing, transaction submission, or public write operation.

## Current blockers

No code blocker remains for M4-2.

Real public Vault data still requires an approved `CURRENT_STATE` binding and a complete verified active snapshot. The UI exposes that absence explicitly.
