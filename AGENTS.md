# Repository contribution rules

These rules apply to every contributor and automation working in this repository.

## Active source of truth

Read these documents before implementation, operations, release work, or architecture changes:

1. `docs/README.md`
2. `docs/product-spec.md`
3. `docs/db-less-runtime-contract.md`
4. `docs/architecture.md`
5. `docs/data-model.md`
6. `docs/status-model.md`
7. `docs/asset-model.md`
8. `docs/collector-design.md`
9. `docs/resource-envelope.md`
10. `docs/testing-strategy.md`
11. `docs/development-roadmap.md`
12. `docs/implementation-status.md`
13. affected UI specification documents for user-visible work

The current tree is authoritative. Historical versions in Git history are forensic evidence only and MUST NOT be used as implementation guidance unless a task explicitly asks for historical analysis.

## Architecture boundary

The active architecture is DB-less.

The canonical production design MUST NOT use:

- Cloudflare D1;
- Cloudflare Queues;
- Cloudflare KV, R2, Durable Objects, or another Cloudflare stateful data product;
- Supabase or another hosted database as the canonical runtime store;
- a Worker scheduled collector as the canonical collector;
- a Git branch as an append-only database.

Cloudflare DNS may remain independent infrastructure. A static hosting provider may be selected separately. The product must continue to function without Cloudflare stateful services.

Persistent public data is published as verified static artifacts. GitHub Actions performs bounded collection. GitHub Release assets are the initial publication target. Replacing the publication provider later requires preserving the same artifact contracts.

## Product boundary

- The product is an independent, read-only XRPL Lending Protocol monitor and historical audit surface.
- The current release target is Devnet.
- Mainnet, wallet connection, signing, transaction submission, lending actions, repayment actions, deposits, withdrawals, and public write APIs are outside the current scope.
- XRP, IOU, and MPT identities and quantities remain distinct.
- Missing or unavailable data is never represented as zero.
- On-ledger state and schedule-derived state remain separate.
- Deleted protocol objects leave current projections but remain available through collected history.
- Current state and historical coverage must expose their independent freshness and continuity boundaries.

## Data integrity

All collection must be:

- validated-ledger based;
- network and epoch scoped;
- restartable and idempotent;
- gap rejecting;
- parent-hash continuous;
- bounded;
- explicit about stale, unavailable, partial, unsupported, and uncollected states.

A current base activates only after a fixed validated ledger has been completely traversed, normalized, hashed, indexed, relationship-checked, and manifest-verified.

A live update activates only after every referenced artifact is uploaded and verified. The channel/manifest pointer is always the final publication step. Failed publication preserves the previously active generation.

## Implementation discipline

- Start from latest `main`.
- Prefer one coherent roadmap unit per pull request.
- Do not create a second parser or second domain model when existing collector/domain code can be reused.
- Do not restore retired D1/Queue/Supabase recovery work as a shortcut.
- Do not make generated data commits on a five-minute cadence.
- Keep large generated data out of Git history.
- Reconcile `development-roadmap.md` and `implementation-status.md` after evidence changes a gate or sequencing decision.
- Do not weaken integrity tests to obtain a passing build.
- Do not describe target behavior as implemented until evidence exists.

## Required validation

The target normal validation after the DB-less migration is:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

Until the migration reaches the cleanup phase, legacy commands may still exist in the repository. Their existence does not make them part of the active architecture.

Additional evidence is required where applicable:

- fixture-ledger replay for parser, lifecycle, archive, balance-history, and reconciliation work;
- non-destructive live Devnet reads for network-dependent collectors;
- full fixed-ledger traversal evidence for a new Current base;
- interruption/retry/idempotence/continuity evidence for live collection;
- publication atomicity evidence for release assets and channel switching;
- browser evidence for user-visible flows and accessibility;
- request/asset-size/runtime measurements before production cutover.

## UI rules

- Preserve the approved dark ledger-observatory direction.
- Preserve keyboard access, visible focus, semantic landmarks, contrast, zoom, reduced motion, long identifiers, and responsive behavior.
- Implement explicit loading, empty, unavailable, stale, partial, error, archived, not-found, invalid-identifier, and coverage-gap states.
- Plain-language summaries supplement rather than replace canonical transaction types, results, identifiers, provenance, and technical detail.
- Generated mockups define visual direction only and never define product data.
