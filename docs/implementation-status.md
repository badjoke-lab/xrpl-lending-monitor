# Implementation status

Last updated: 2026-07-03.

## Current milestone

**M1 closeout** and **M5-3 — Cover, debt, and loss audit**.

M0, M2, M3, M4-0 through M4-7, and M5-1 through M5-2 are complete. M5-3 is active. M1 still requires a complete marker-aware bootstrap, verification, activation, rollback, cleanup, and resource evidence.

## Canonical continuation point

Latest merged work:

- PR #29: `Add current Loan monitor UI`;
- squash merge: `e29a7a826562f449edb656aa7f245135f69bb2a8`;
- PR #31: `Add Activity and transaction monitoring`;
- squash merge: `541650294a2dea04ff72b96a7258b9ea6f583f3c`;
- PR #32: `Add global Search and Account relationship monitoring`;
- squash merge: `e92ba32ed57d9ca36f0db17793982222e3143db9`;
- PR #33: `Add project and data documentation pages`;
- squash merge: `89d9c85b`;
- PR #35: `Configure Cloudflare D1 database binding`;
- merge commit: `33edaa9c897aa9f05cce4b112c85e948c73d9e4e`;
- PR #36: `Document Cloudflare production deployment`;
- merge commit: `f22c0cecee641c5818d5b16df28bbac265a5cf01`;
- PR #34: `Complete M4 baseline integration and Checkpoint C`;
- squash merge: `f7ae7032715c57234bb94dcbc3aeddce23e30a67`;
- PR #37: `Add Loan lifecycle audit`;
- squash merge: `6e3e2af11bffdb570b675a4888ad6e4b58bb6c9b`;
- PR #38: `Add archived object audit`;
- squash merge: `7faf39d7217ce6e7438346e478a6416243929dd9`.

Active implementation:

- branch: `ui/m5-3-cover-debt-loss-audit`;
- milestone unit: M5-3;
- base: `main` at `7faf39d7217ce6e7438346e478a6416243929dd9`;
- scope: asset-separated debt, maximum debt, cover available, unrealized loss, required minimum cover, and cover surplus/shortfall audit history with Broker/Vault context, source transactions, formula inputs, and browser/API regression coverage.

## Production D1 schema

Approved production D1 migration was applied on 2026-07-03 with:

```sh
pnpm exec wrangler d1 migrations apply xrpl-lending-monitor --remote
```

Target:

- database: `xrpl-lending-monitor`;
- database ID: `bebc2c68-03d2-4a1c-98a7-46b34ee4e25d`.

Evidence:

- all eight migrations `0001_network_epochs.sql` through `0008_balance_history.sql` applied successfully;
- `pnpm exec wrangler d1 migrations list xrpl-lending-monitor --remote` reported `No migrations to apply`;
- read-only `sqlite_master` query verified expected tables and indexes with `changed_db: false` and `rows_written: 0`;
- deployed `https://xrpl-lending-monitor.badjoke-lab.workers.dev/api/status` returned HTTP 200 with `collector.status = uninitialized`;
- deployed `/api/overview` returned HTTP 200 with unavailable active-snapshot state and null counts;
- deployed `/api/activity?limit=6` returned HTTP 200 with an empty indexed data array.

No current-state snapshot was created or activated.

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

## Completed M4-6

Available routes:

- `/about` with purpose, users, scope, independence, read-only status, audit differentiation, non-goals, repository, Methodology, API, and Contact links;
- `/methodology` with a complete 20-section table of contents and stable anchors covering sources, validated ledgers, bootstrap, marker resume, collection, AffectedNodes, assets, lifecycle, status, formulas, archives, epochs, provenance, missing data, idempotency, storage, API behavior, limitations, and release verification;
- `/api` with all current public endpoints, common semantics, validation limits, pagination and cursor rules, current-state availability, history and Search behavior, exports and feeds, errors, and clearly labeled illustrative response shapes;
- `/contact` with a configured public GitHub Issues route, explicit unavailable state for the unconfigured private form, and a public-issue privacy and secret warning;
- centralized public external-link configuration;
- desktop and mobile navigation for all four routes;
- responsive long-form, table, code example, table-of-contents, and contact layouts;
- focused documentation browser tests.

No placeholder external destination is published.

## Completed M4-7

Delivered:

- reusable route-aware `Breadcrumbs` component with unit coverage for top-level, detail, and invalid routes;
- SPA navigation, browser history, hash deep-link, and focus restoration coverage;
- keyboard skip-link and one-main-landmark/one-H1 assertions;
- shared Devnet, read-only, epoch, and freshness context assertions across route changes;
- mobile documentation route checks and 200% text-size horizontal-overflow regression coverage;
- unsupported control regression for wallet, signing, transaction submission, payment, donation, USD total, and risk-score surfaces;
- Checkpoint C documentation in `docs/checkpoint-c.md`.

PR #34 passed CI and was squash-merged at `f7ae7032715c57234bb94dcbc3aeddce23e30a67`.

## Completed M5-1

Delivered:

- `GET /api/audit/lifecycle` protocol-wide bounded lifecycle endpoint with `event_type`, `loan_id`, and `limit` filters;
- Lifecycle audit page at `/audit/lifecycle`;
- desktop sidebar and mobile More navigation to Lifecycle;
- Loan detail panels for indexed lifecycle events and normalized before/after Loan state changes;
- source transaction links and raw indexed details where retained;
- explicit empty/unavailable states instead of inferred lifecycle or payment history;
- focused API and browser tests.

Validation:

- `pnpm install --frozen-lockfile` exited successfully with dependencies already up to date; pnpm printed a registry metadata fetch warning;
- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm test` — 168 passed, 3 skipped;
- `pnpm db:migrate:local`;
- `pnpm build`;
- `pnpm test:e2e` — 26 passed.

PR #37 passed CI and was squash-merged at `6e3e2af11bffdb570b675a4888ad6e4b58bb6c9b`.

## Completed M5-2

Delivered:

- `GET /api/audit/archived` bounded explorer endpoint with object-type and exact-query filters;
- `GET /api/audit/archived/:objectType/:objectId` detail endpoint for archived Vault, Loan Broker, and Loan records;
- Archived Objects page at `/audit/archived`;
- archived object detail page at `/audit/archived/:objectType/:objectId`;
- desktop sidebar and mobile More navigation to Archived Objects;
- source deletion transaction links, final retained state JSON, indexed relationships, archive metadata, and explicit current-context warning;
- focused API and browser tests.

Local validation:

- `pnpm install --frozen-lockfile`;
- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm test` — 172 passed, 3 skipped;
- `pnpm db:migrate:local`;
- `pnpm build`;
- `pnpm test:e2e` — 29 passed;
- CI `quality` passed.

PR #38 passed CI and was squash-merged at `7faf39d7217ce6e7438346e478a6416243929dd9`.

## Active M5-3

Implemented on the active branch:

- `GET /api/audit/cover-loss` bounded endpoint with metric, subject, and asset filters;
- Cover & Loss audit page at `/audit/cover-loss`;
- desktop sidebar and mobile More navigation to Cover & Loss;
- asset-separated before/after DebtTotal, DebtMaximum, CoverAvailable, LossUnrealized, required minimum cover, and cover surplus/shortfall records;
- source transaction links, Broker/Vault current lookups, formula strings, indexed source fields, and explicit no-cross-asset aggregation messaging;
- focused API, breadcrumb, and browser tests.

Local validation:

- `pnpm install --frozen-lockfile`;
- `pnpm check` — includes lint, type-check, unit tests with 175 passed and 3 skipped, local D1 migration replay, and production build;
- `pnpm test:e2e` — 31 passed.

First incomplete action:

- open PR for M5-3;
- inspect CI and merge only after required checks pass.

## Known open questions

| Question | Evidence | Point |
|---|---|---|
| Failed bootstrap prefix retention | Preview cleanup and rollback measurements | M1 closeout |
| Broker and Loan shard-cap tuning | Real preview density and response measurements | M1 preview / M6 |
| Current Loan counts by Broker | Bounded aggregation or indexed relationship API | M5 |
| Full Broker history panels | Indexed audit integration | M5 |
| Private contact form URL | Explicit configuration approval | M6 |

## Active prohibitions

- no unlabeled quantity;
- no inferred impairment, default, credit, safety, identity, affiliation, or risk state;
- no schedule eligibility presented as on-ledger default;
- no cross-snapshot relationship;
- no unavailable-data-to-zero substitution;
- no USD conversion, price feed, cross-asset total, or proprietary score;
- no funding, donation, payment, or promotional surface in the current release;
- no unapproved remote infrastructure change, deployment, Mainnet, wallet, signing, transaction submission, or public write operation.

## Current blockers

No code blocker prevents continuing M5.

Real public current-state data still requires an approved `CURRENT_STATE` binding and a complete verified active snapshot. Current-state APIs and UI routes must continue to expose that absence explicitly.
