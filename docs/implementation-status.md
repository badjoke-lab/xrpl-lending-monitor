# Implementation status

Last updated: 2026-07-02.

## Current milestone

**M1 closeout — Current-state collector activation** and **M4-2 — Vault UI**.

M0, M2, M3, M4-0, and M4-1 are complete. The verified current-state Vault read dependency is also complete. M1 still requires a complete isolated preview bootstrap, verified activation, rollback, cleanup, and resource evidence.

## Canonical continuation point

Latest merged dependency:

- PR #23: `Add verified current-state Vault reader`;
- squash merge: `3445d1bf86805c28ca3aa6cce2202338757106b6`;
- CI passed lint, type-check, unit tests, local D1 migrations, build, and Chromium smoke tests;
- no remote R2 resource, binding configuration, D1 migration, or deployment was performed.

Active M4-2 branch:

- branch: `ui/vault-monitor`;
- base: `main` at `3445d1bf86805c28ca3aa6cce2202338757106b6`;
- scope: Vault list, Vault detail, filters, bounded cursor navigation, explicit unavailable states, raw data, and responsive browser coverage.

## Immediate work

1. open the focused Vault UI pull request;
2. validate lint, type-check, unit tests, local D1 migrations, build, and all Playwright tests;
3. fix failures without inventing data or weakening unavailable, provenance, responsive, or accessibility rules;
4. record final evidence and merge only after required checks pass;
5. begin M4-3 Loan Broker API dependency and UI from updated `main`.

The first incomplete action is opening and validating the M4-2 pull request.

## Completed foundations

### Current-state Vault API

The merged public read layer verifies the active manifest and compressed shard metadata and content digests before exposing data. Reads are snapshot-bound, cursor-based, bounded by shard count, and fail closed on integrity errors.

Available routes:

- `GET /api/vaults`;
- `GET /api/vaults/:vaultId`.

The collection supports `limit`, opaque cursor, `id_asc` or `id_desc`, factual text search, and `has_loss`. The detail lookup uses manifest object-index ranges to choose one candidate shard.

Exact derived fields are:

- `used_assets = AssetsTotal - AssetsAvailable`;
- `utilization_bps = floor(used_assets / AssetsTotal * 10000)`.

Without an active snapshot or configured storage binding, the API returns explicit unavailable state rather than zero or invented objects.

## Active M4-2 implementation

### Vault list — `/vaults`

Implemented:

- active sidebar and mobile More navigation;
- page title, Devnet context, refresh, and direct JSON link;
- text search over supported factual identity fields;
- unrealized-loss filter;
- Vault ID ascending and descending sort;
- bounded opaque-cursor Next and Previous navigation;
- current snapshot and ledger context;
- Vault ID, owner, canonical asset, total, available, used, utilization, loss, and previous-ledger columns;
- direct collection provenance;
- shard-read and object-examination counts;
- loading, empty, unavailable, and request-error behavior;
- no fiat values, cross-asset totals, unsupported relationships, or fabricated counts.

### Vault detail — `/vaults/:vaultId`

Implemented:

- route validation through the existing 64-character identifier pattern;
- breadcrumbs and active Vault navigation;
- asset, total, available, and utilization summary cards;
- direct owner, pseudo-account, Share MPT, Domain, withdrawal policy, scale, flags, previous transaction, and previous ledger fields;
- exact assets total, available, maximum, used, and unrealized loss values;
- formula and derived provenance;
- explicit unavailable relationship panel instead of inferred Broker, Loan, activity, or history data;
- raw decoded object after the human-readable summary;
- direct API link and refresh action.

### Responsive behavior

Implemented:

- multi-column desktop filter controls and summary cards;
- tablet two-column reflow;
- mobile single-column filters and responsive summary cards;
- dedicated table overflow rather than page-level horizontal scrolling;
- full raw-object wrapping and overflow handling;
- mobile Vault access through the More menu.

### Shared UI changes

- generic abortable `useApiResource` hook;
- Vault API response types;
- Vault list/detail routes in the existing History API router;
- sidebar active state for detail subroutes;
- separate Vault page stylesheet loaded by the application entry point.

## Tests added

`tests/e2e/vaults.spec.ts` covers:

1. available Vault collection, exact values, no USD output, detail navigation, raw data, and explicit relationship unavailability;
2. unavailable snapshot state and factual search/loss/sort request parameters;
3. narrow mobile layout and Vault navigation through the More menu.

Final CI evidence is pending.

## Known open questions

| Question | Evidence | Point |
|---|---|---|
| Failed bootstrap prefix retention | Preview cleanup and rollback measurements | M1 closeout |
| Manifest cache policy | Preview latency and request evidence | M6 |
| Public shard cap tuning | Real shard-density and response-size evidence | M1 preview / M6 |
| Connected Vault relationship API | Verified Loan Broker and Loan readers plus history queries | M4-3 to M5 |
| Contact URLs | Explicit configuration approval | M4-6 |
| Initial Support enablement | Approved payment configuration and disclosures | M4-6 / Checkpoint D |

## Active prohibitions

- generated mockup values are not facts;
- unavailable data is not zero;
- no unverified or unbounded public current-state read;
- no inferred Vault relationships;
- no USD conversion, pricing oracle, cross-asset total, or proprietary risk score;
- no remote infrastructure change, deployment, Mainnet, wallet, signing, transaction submission, or public write operation.

## Current blockers

No known code blocker prevents local and CI validation of M4-2.

Real public Vault data still requires an approved `CURRENT_STATE` binding and a complete verified active snapshot. The UI already exposes that absence as unavailable.
