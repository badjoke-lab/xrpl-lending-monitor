# Repository contribution rules

These rules apply to every contributor and automation working in this repository.

## Source of truth

Before changing code or documentation, read:

1. `docs/README.md`
2. `docs/product-spec.md`
3. `docs/architecture.md`
4. `docs/data-model.md`
5. `docs/status-model.md`
6. `docs/asset-model.md`
7. `docs/collector-design.md`
8. `docs/testing-strategy.md`
9. `docs/resource-envelope.md`
10. `docs/development-roadmap.md`
11. `docs/implementation-status.md`
12. the UI specification documents for user-visible work

Repository documents are authoritative when they agree with implementation and verified evidence. Correct stale documentation in the same pull request as the related change.

## Product boundary

- The public product is an independent, read-only XRPL Lending Protocol monitor.
- The initial release is Devnet only.
- Mainnet, wallet connection, signing, transaction submission, lending actions, repayment actions, deposits, withdrawals, and public write APIs are outside scope.
- Funding, donation, payment, pricing, fiat conversion, cross-asset totals, and proprietary risk or credit scores are outside scope.
- XRP, IOU, and MPT identities and quantities must remain distinct.
- Missing or unavailable data is never represented as zero.
- On-ledger state and schedule-derived state must remain separate.
- A partial bootstrap must never activate or be reported as complete.
- Deleted protocol objects leave current projections but remain available through indexed history where collected.

## Data integrity

Collection and persistence must be:

- validated-ledger based;
- network and epoch scoped;
- marker-aware or cursor-aware;
- restartable and idempotent;
- gap rejecting;
- bounded by the documented resource envelope;
- atomic at the defined commit boundary;
- explicit about unavailable, stale, partial, and unsupported data.

Current-state activation requires one fixed validated ledger, complete traversal, deterministic object hashing, manifest verification, relationship checks, and an atomic active-pointer switch. A failed replacement must preserve the prior active snapshot.

## Implementation discipline

- Work from the current canonical predecessor.
- Prefer one coherent roadmap unit per pull request.
- Do not create parallel implementations of the same feature.
- Update affected specifications, roadmap status, resource limits, and operational documentation with the implementation.
- Do not weaken tests or integrity guarantees to obtain a passing build.
- Do not merge with failing required checks, stale migrations, unresolved material findings, or contradictory documentation.

## Required validation

Run checks appropriate to the changed surface. The normal full validation is:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm test:e2e
```

Additional evidence is required where applicable:

- local D1 migration application for schema changes;
- fixture-ledger replay for parser, history, lifecycle, archive, and reconciliation work;
- non-destructive live Devnet reads for network-dependent collectors;
- browser evidence for user-visible flows and accessibility;
- runtime, request, storage, and recovery measurements for collector and bootstrap changes;
- rollback and interruption evidence for persistence and deployment changes.

## Public-information boundary

Repository content and generated artifacts must not contain:

- credentials, access tokens, private keys, seeds, or private endpoints;
- personal billing, account, or budget information;
- unnecessary provider account identifiers or internal incident details;
- unpublished operational strategy or unrelated project context;
- unredacted personal data.

Public documentation should explain decisions through product integrity, security, maintainability, measurable resource limits, accessibility, and operational reliability.

## UI rules

- Use the approved dark ledger-observatory direction.
- Preserve keyboard access, visible focus, semantic landmarks, contrast, zoom, reduced motion, long identifiers, and responsive behavior.
- Implement explicit loading, empty, unavailable, stale, partial, error, archived, not-found, and invalid-identifier states.
- Generated mockups define visual direction only and never define product data.
- Do not publish placeholder external links.
