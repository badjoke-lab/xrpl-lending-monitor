# Implementation status

Last updated: 2026-07-03.

## Current milestone

**M1 closeout** and **M4-7 — Baseline integration, accessibility, and Checkpoint C**.

M0, M2, M3, M4-0, M4-1, M4-2, M4-3, M4-4, M4-5, and M4-6 are complete. M4-7 is active on PR #34. M1 still requires an approved isolated preview environment, complete bootstrap, verification, activation, rollback, cleanup, and resource evidence.

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
- merge commit: `f22c0cecee641c5818d5b16df28bbac265a5cf01`.

Active implementation:

- branch: `ui/m4-7-baseline-integration`;
- pull request: #34, `Complete M4 baseline integration and Checkpoint C`;
- milestone unit: M4-7;
- base integrated: `origin/main` at `f22c0cecee641c5818d5b16df28bbac265a5cf01`;
- temporary diagnostic workflow removed;
- local validation after the documentation zoom overflow fix: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:migrate:local`, `pnpm build`, and `pnpm test:e2e` passed.

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

## Active M4-7

Implemented on the active branch:

- reusable route-aware `Breadcrumbs` component with unit coverage for top-level, detail, and invalid routes;
- SPA navigation, browser history, hash deep-link, and focus restoration coverage;
- keyboard skip-link and one-main-landmark/one-H1 assertions;
- shared Devnet, read-only, epoch, and freshness context assertions across route changes;
- mobile documentation route checks and 200% text-size horizontal-overflow regression coverage;
- unsupported control regression for wallet, signing, transaction submission, payment, donation, USD total, and risk-score surfaces;
- Checkpoint C documentation in `docs/checkpoint-c.md`.

First incomplete action:

- push PR #34 once GitHub authentication is restored;
- inspect CI once the push is available on GitHub;
- squash merge only after required checks pass.

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
