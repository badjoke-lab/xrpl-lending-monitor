# Implementation status

Last updated: 2026-07-01.

## Current milestone

**M1 — Current-state collector**

## Current branch

`collector/network-epoch-foundation`

## Current work

Roadmap PR 4: Devnet network, amendment, epoch, and synchronization-status foundation.

The GitHub pull request number is #3 because the repository foundation and specification work were combined into the first merged PR.

## Completed

### M0 — Foundation and specification lock

- Repository created: `badjoke-lab/xrpl-lending-monitor`
- PR #1 merged: source-of-truth specifications and development roadmap
- PR #2 merged: pinned TypeScript, React/Vite, Hono Worker, D1, test, and CI skeleton
- Repository operating rules in `AGENTS.md`
- Product, architecture, data, status, asset, collector, testing, free-tier, competitor, roadmap, and decision documents
- Mainnet-fail-closed runtime configuration
- Read-only foundation UI and API boundary
- Frozen-lockfile CI with lint, type-check, unit, build, and browser checks

### Active branch implementation

- Canonical LendingProtocol and SingleAssetVault amendment IDs
- Validated XRPL JSON-RPC client
- HTTPS-only endpoint configuration, timeout, and optional fallback
- Same-endpoint `server_info` and amendment snapshot reads
- Validated-ledger, server-version, server-state, and complete-ledger parsing
- Initial Devnet reset-signal detection for ledger rewind and same-index hash change
- Deterministic initial epoch ID and status planning
- Healthy, stale, error, and reset-suspected synchronization states
- `network_epochs` and `sync_state` D1 migration
- D1 persistence for successful and failed status refreshes
- Scheduled Worker handler for network-status refresh
- D1-backed read-only `/api/status`
- Explicit amendment, freshness, cursor, error, and reset fields in the API
- Unit tests for RPC configuration, endpoint fallback, response parsing, reset detection, status planning, and API serialization
- Local D1 migration application in CI

## Active PR

### PR #3 — Add Devnet network status and epoch foundation

Roadmap slot: PR 4.

Current validation:

- frozen-lockfile install: passed
- lint: passed
- type-check: passed
- unit tests: passed
- local D1 migration apply: passed
- build: passed
- browser smoke test: passed

Remaining before merge:

- repository documentation review;
- mark the draft ready;
- final clean CI on the documented head.

## Next PR

### Roadmap PR 5 — Asset normalization

Planned scope:

- XRP normalization;
- IOU currency and issuer identity;
- MPT issuance identity and metadata resolution;
- exact decimal amount utilities;
- rate-unit conversion;
- Ripple epoch conversion;
- fixtures for missing and complete metadata;
- API-safe asset serialization;
- enforcement that unlike assets cannot be aggregated.

## Following PR

### Roadmap PR 6 — Current object scanner and free-tier benchmark checkpoint

- complete marker traversal for Vault, LoanBroker, and Loan;
- current-state projections;
- relationship checks;
- partial-scan failure behavior;
- CPU, external request, D1, and storage measurements;
- decision between Cloudflare Cron Worker, reduced cadence, or the approved free fallback.

## Known open questions

| Question | Required evidence | Assigned point |
|---|---|---|
| Can the collector remain under the Workers Free 10 ms CPU limit? | p50, p95, and max CPU benchmark with production-shaped payloads | Roadmap PR 6 / Checkpoint A |
| What exact schedule-state boundary labels should be public? | unit tests against due time and grace-end boundaries | Roadmap PR 12 |
| What is the confirmed successful overpayment transaction shape? | isolated Devnet fixture and validated metadata | Roadmap PR 9 |
| How should each deletion reason be classified? | transaction and DeletedNode fixtures for full payment, default, Broker delete, and Vault delete | Roadmap PR 10 |
| What MPT metadata is reliably available from public RPC? | live and fixture tests with missing and complete metadata | Roadmap PR 5 |
| Which additional signals reliably confirm a Devnet reset? | simulated reset, second-endpoint confirmation, and live observation | Roadmap PR 25 |
| Is GitHub Actions required as the collector fallback? | Worker benchmark failure or insufficient catch-up capacity | Checkpoint A |

## Decisions made in the active PR

- A reset signal does not immediately archive the current epoch. It moves sync state to `reset_suspected`; verified rollover is deferred to the reset-hardening work.
- All amendment and server values are read from the same endpoint for one snapshot.
- The public status endpoint reads D1 only; it does not mutate state or call XRPL on demand.
- Production Cron activation and real D1 provisioning remain disabled.

## Current blockers

None.

## Schedule status

- M0: complete
- M1 network/epoch foundation: in progress and on schedule
- Asset normalization: next
- Current object scanner and free-tier checkpoint: follows asset normalization

## Risks being watched

- Free Worker CPU limit may be too low for the full collector.
- Devnet can reset and erase current public history.
- A single reset signal can be transient and therefore requires confirmation before epoch rollover.
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
