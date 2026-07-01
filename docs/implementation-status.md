# Implementation status

Last updated: 2026-07-01.

## Current milestone

**M0 — Foundation and specification lock**

## Current branch

`foundation/project-skeleton`

## Current work

Project skeleton implementation: pinned toolchain, React/Vite application shell, read-only Cloudflare Worker, D1 binding boundary, fail-closed Devnet configuration, tests, and CI.

## Completed

### M0 source of truth

- Repository created: `badjoke-lab/xrpl-lending-monitor`
- PR #1 merged: source-of-truth specifications and development roadmap
- Repository operating rules
- Documentation index
- Product specification
- Architecture specification
- Data model
- Loan status model
- Asset model
- Collector design
- Testing strategy
- Free-tier operating budget and benchmark gate
- Competitor positioning
- Dated development roadmap
- Decision log and PR documentation checklist

### Project skeleton on current branch

- Node and pnpm versions pinned
- Exact application and development dependency versions pinned
- TypeScript configuration for UI, Worker, and tooling
- React and Vite application entrypoint
- Truthful foundation UI with no fabricated protocol data
- Hono Worker with read-only `/api/health` and `/api/status`
- Cloudflare Static Assets and D1 binding configuration
- Placeholder D1 database ID to block accidental production deployment
- Devnet-only, Mainnet-fail-closed runtime validation
- Unit tests for network configuration
- Playwright browser smoke test
- ESLint, Vitest, Vite, Wrangler, and Playwright configuration
- GitHub Actions quality pipeline
- D1 migration operating rules

## Active PR

### Project skeleton

Expected completion condition:

- dependency installation succeeds in CI;
- lint, type-check, unit tests, build, and browser smoke tests pass;
- no production deployment occurs;
- no Group Pay dependency exists;
- documentation and implementation agree.

## Next PR

### PR 4 — Network, amendment, and epoch foundation

Planned scope:

- XRPL Devnet RPC client boundary;
- endpoint fallback and timeout behavior;
- server information and validated-ledger reads;
- amendment-status reads;
- `network_epochs` and `sync_state` D1 migration;
- reset-signal detection skeleton;
- D1-backed `/api/status`;
- fixture and integration tests;
- Mainnet remains disabled.

## Following PRs

- PR 5 — Asset normalization
- PR 6 — Current object scanner and free-tier benchmark checkpoint

## Known open questions

| Question | Required evidence | Assigned point |
|---|---|---|
| Can the collector remain under the Workers Free 10 ms CPU limit? | p50, p95, and max CPU benchmark with production-shaped payloads | PR 6 / Checkpoint A |
| What exact schedule-state boundary labels should be public? | unit tests against due time and grace-end boundaries | PR 12 |
| What is the confirmed successful overpayment transaction shape? | isolated Devnet fixture and validated metadata | PR 9 |
| How should each deletion reason be classified? | transaction and DeletedNode fixtures for full payment, default, Broker delete, and Vault delete | PR 10 |
| What MPT metadata is reliably available from public RPC? | live and fixture tests with missing and complete metadata | PR 5 |
| What signals reliably identify a Devnet reset? | simulated reset fixtures plus live observation | PR 4 and PR 25 |
| Is GitHub Actions required as the collector fallback? | Worker benchmark failure or insufficient catch-up capacity | Checkpoint A |

## Current blockers

No product blocker.

A lockfile is not yet committed because dependency resolution is being verified by the first CI run. Dependencies are exact-pinned and CI currently installs without frozen-lockfile enforcement. A generated lockfile must be committed before the foundation milestone is considered fully settled.

## Schedule status

- M0 specification work: complete
- Project skeleton: in progress and within the roadmap window
- M1 collection work: not started

## Risks being watched

- Free Worker CPU limit may be too low for the collector.
- Devnet can reset and erase current public history.
- Public RPC behavior and available history may change.
- MPT metadata may be incomplete.
- Mainnet activation timing is unknown.
- A direct competitor may expand into full lifecycle history.
- Dependency versions are new and must be proven together by CI before merge.

## Operational rule

Every future PR must update this file with:

- current milestone;
- completed work;
- next PR;
- new blockers or resolved blockers;
- open questions created or closed;
- schedule drift.
