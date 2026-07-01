# Implementation status

Last updated: 2026-07-01.

## Current milestone

**M0 — Foundation and specification lock**

## Current branch

`foundation/project-skeleton`

## Current work

Final validation and merge preparation for the project skeleton.

## Completed

### Source-of-truth foundation

- Repository created: `badjoke-lab/xrpl-lending-monitor`
- PR #1 merged: source-of-truth specifications and development roadmap
- Repository operating rules in `AGENTS.md`
- Documentation index and PR checklist
- Product, architecture, data, status, asset, collector, testing, free-tier, competitor, roadmap, and decision documents
- Requirement that every implementation PR updates this file and relevant specifications

### Project skeleton on the active branch

- Node.js and pnpm versions pinned
- Exact dependency versions and committed `pnpm-lock.yaml`
- Explicit pnpm build-script approvals in `pnpm-workspace.yaml`
- TypeScript configuration for UI, Worker, and tooling
- React and Vite application entrypoint
- Truthful foundation UI with no fabricated protocol data
- Hono Worker with read-only `/api/health` and `/api/status`
- Cloudflare Static Assets and D1 binding configuration
- Placeholder D1 database ID to prevent accidental production deployment
- Devnet-only, Mainnet-fail-closed runtime validation
- Unit tests for network configuration
- Playwright browser smoke test
- ESLint, Vitest, Vite, Wrangler, and Playwright configuration
- Read-only GitHub Actions CI using frozen-lockfile installation
- D1 migration operating rules
- Successful CI validation of install, lint, type-check, unit tests, build, Chromium installation, and browser smoke test

## Active PR

### PR #2 — Project skeleton

Merge conditions:

- clean frozen-lockfile CI passes;
- documentation and implementation agree;
- no production deployment occurs;
- no Group Pay dependency exists.

After merge, M0 is complete and work advances to M1.

## Next PR

### PR 4 — Network, amendment, and epoch foundation

Planned scope:

- XRPL Devnet RPC client boundary;
- endpoint fallback, timeout, and response validation;
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

None.

## Schedule status

- M0 specifications: complete
- Project skeleton: complete on branch, pending merge
- M1 collection work: next
- Roadmap timing: on schedule

## Risks being watched

- Free Worker CPU limit may be too low for the collector.
- Devnet can reset and erase current public history.
- Public RPC behavior and available history may change.
- MPT metadata may be incomplete.
- Mainnet activation timing is unknown.
- A direct competitor may expand into full lifecycle history.

## Operational rule

Every future PR must update this file with:

- current milestone;
- completed work;
- next PR;
- new blockers or resolved blockers;
- open questions created or closed;
- schedule drift.
