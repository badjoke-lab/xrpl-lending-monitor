# Codex UI execution task

## Purpose

This task controls M4 and M5 UI execution after the UI architecture and roadmap documentation is merged. It supplements `codex-master-task.md` and is subordinate to the product, architecture, data, status, asset, testing, resource, and UI source-of-truth documents.

## Mandatory reading order

Before UI work, read:

1. `AGENTS.md`;
2. `docs/product-spec.md`;
3. `docs/architecture.md`;
4. `docs/ui-information-architecture.md`;
5. `docs/ui-page-map.md`;
6. `docs/ui-page-specifications.md`;
7. `docs/ui-design-spec.md`;
8. `docs/ui-component-inventory.md`;
9. `docs/ui-responsive-rules.md`;
10. `docs/ui-reference/README.md`;
11. `docs/development-roadmap.md`;
12. `docs/implementation-status.md`.

When these documents conflict, stop UI implementation and correct the conflict in a focused documentation change before continuing.

## Current checkpoint boundary

A WIP checkpoint exists on branch `ui/overview-status-shell` at commit `aa623b9`. It contains a functional first-pass API-fetching Overview shell but uses a light simplified presentation that does not match the approved design.

Rules:

- do not merge `aa623b9` as-is;
- preserve useful API types, fetch logic, loading/error behavior, and tests where correct;
- replace the visual shell and information architecture with the approved ledger-observatory design;
- do not force-push or erase the checkpoint history merely to make the branch look clean;
- rebase or merge the documentation PR only after it is merged and after inspecting the actual branch state.

## UI execution order

Follow the current `development-roadmap.md` order.

### M4-0 — UI specification and route architecture

This documentation unit must be merged before M4 code resumes.

### M4-1 — App shell, Overview, and Network Status

Implement only:

- responsive application shell;
- desktop sidebar;
- mobile navigation;
- persistent network context bar;
- Overview;
- Network Status;
- shared loading, empty, unavailable, stale, partial, error, not-found, and invalid-identifier states;
- design tokens and foundational components;
- focused component and Playwright tests.

Do not begin Vault, Loan Broker, Loan, Activity, project pages, or M5 audit pages until this unit is green, reviewed, and merged.

### M4-2 through M4-7

Continue only in roadmap order and keep each pull request focused.

## Data rules

Never invent or imply:

- USD or fiat conversion;
- oracle or DEX pricing;
- cross-asset totals;
- unsupported counts or status states;
- peer count, uptime, or error-rate metrics absent from the API;
- proprietary health, safety, credit, or risk scores;
- borrower identity or KYC information;
- complete current state before active snapshot activation;
- Mainnet monitoring;
- wallet, signing, transaction submission, or write operations.

When a value is absent, show the appropriate Unavailable, Empty, Stale, Partial, or Error state rather than zero or a mock value.

## Design rules

Implement:

- dark navy to near-black ledger-observatory surfaces;
- cyan primary accent;
- restrained factual state colors;
- thin borders and clear hierarchy;
- monospace identifiers and hashes;
- summary-first entity pages;
- provenance treatment;
- explicit current versus archived context;
- desktop and mobile layouts defined in the responsive specification.

Generated mockups are layout references only. The API and specifications are the data authority.

## About, Methodology, Contact, and Support

### About

Implement as a project page explaining purpose, users, scope, independence, read-only behavior, non-goals, repository, Methodology, Contact, and optional Support.

### Methodology

Implement the full long-form technical structure in `ui-page-specifications.md`, with stable anchors and an on-page table of contents.

### Contact

Use configured external URLs only:

- Google Form for general or private contact;
- GitHub Issues for public technical reports and data corrections.

Do not publish placeholder URLs. Include the public-disclosure warning.

### Support

Support is disabled by default. Enable `/about#support` and navigation only after explicit approval of:

- address;
- network;
- accepted asset;
- destination-tag rule;
- QR payload;
- disclosure text;
- operational ownership.

Do not place support prompts inside monitoring or audit data surfaces.

## Testing requirements

For each UI unit, add focused tests for:

- successful API data;
- loading;
- empty;
- unavailable;
- stale;
- partial failure;
- error;
- long identifiers;
- keyboard navigation;
- mobile layout;
- no unsupported value invention.

Run the applicable set:

- focused unit/component tests;
- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm test`;
- `pnpm build`;
- `pnpm test:e2e`;
- `pnpm check`.

Record exact evidence in `implementation-status.md` and the pull-request body.

## Pull-request rules

Each UI pull request must include:

- pages and components changed;
- API dependencies;
- supported data states;
- responsive behavior;
- accessibility coverage;
- screenshots or browser evidence where practical;
- tests;
- known unavailable data;
- rollback plan;
- explicit exclusions.

Do not merge without explicit authorization and green required checks.

## External and deployment boundaries

UI work does not authorize:

- Cloudflare resource creation;
- remote D1 migrations;
- R2 provisioning;
- deployment;
- Cron activation;
- domain changes;
- production bootstrap;
- Mainnet configuration.

Stop at the relevant human approval gate and persist progress first.
