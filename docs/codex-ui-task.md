# Codex UI execution task

## Purpose

This task controls M4 and M5 UI execution. It supplements `codex-master-task.md` and remains subordinate to the product, architecture, data, status, asset, testing, resource, and UI source-of-truth documents.

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

When these documents conflict, stop the conflicting implementation path and correct the conflict in a focused documentation change before continuing.

## Historical checkpoint boundary

The WIP checkpoint on branch `ui/overview-status-shell` at commit `aa623b9` is historical and must not be merged as-is. Preserve useful logic only when it agrees with current `main` and the approved design.

## UI execution order

Follow the current `development-roadmap.md` order.

### Completed units

- M4-0 — UI specification and route architecture;
- M4-1 — App shell, Overview, and Network Status;
- M4-2 — Vault UI;
- M4-3 — Loan Broker UI.

### Active unit

M4-4 begins with the verified current-state Loan reader dependency, followed by the Loan list and detail UI.

Required sequence:

1. define bounded Loan list and detail contracts;
2. read and verify Loan shards;
3. resolve same-snapshot Loan Broker and Vault relationships;
4. preserve canonical asset identity;
5. serialize exact terms, balances, dates, flags, and provenance;
6. keep on-ledger and schedule states separate;
7. expose explicit unavailable behavior;
8. implement Loan list and detail routes;
9. add focused unit, integration, and browser tests;
10. update implementation status and merge only after required checks pass.

Continue M4-5 through M6 only in roadmap order.

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
- wallet, funding, payment, signing, transaction submission, or write operations.

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

## Project pages

### About

Explain purpose, users, scope, independence, read-only behavior, non-goals, repository, Methodology, and Contact.

### Methodology

Implement the full long-form technical structure in `ui-page-specifications.md`, with stable anchors and an on-page table of contents.

### Contact

Use configured external URLs only:

- Google Form for general or private contact;
- GitHub Issues for public technical reports and data corrections.

Do not publish placeholder URLs. Include the public-disclosure warning.

Funding, donation, payment, and promotional surfaces are outside the current UI scope.

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

- focused unit or component tests;
- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm test`;
- `pnpm build`;
- `pnpm test:e2e`;
- `pnpm check`.

Record exact evidence in `implementation-status.md` and the pull-request body.

## Pull-request rules

Each UI pull request includes:

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

Do not merge without authorization and green required checks.

## External and deployment boundaries

UI work does not authorize:

- Cloudflare resource creation;
- remote D1 migrations;
- object-storage provisioning;
- deployment;
- Cron activation;
- domain changes;
- production bootstrap;
- Mainnet configuration.

Stop at the relevant human approval gate and persist progress first.