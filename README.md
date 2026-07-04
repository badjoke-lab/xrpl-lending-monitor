# XRPL Lending Monitor

Read-only monitoring, history, and audit tooling for the XRPL Lending Protocol.

The project covers the normal monitoring surface expected from a lending dashboard—overview, Vaults, Loan Brokers, Loans, activity, search, and network status—while preserving lifecycle history, deleted objects, state transitions, first-loss cover changes, provenance, and Devnet epochs within the collected evidence boundary.

## Current status

Milestone 1: incremental continuation and base-plus-overlay integration.

A verified Devnet base read model is serving current Vault, Loan Broker, and Loan data through the public current-state API path. The active published base is fixed to validated Devnet ledger `3371675` and contains 1,552,503 current-state records.

The incremental history foundation, AffectedNodes normalization, lifecycle derivation, deleted-object archive logic, balance history, public API contracts, and baseline UI are implemented. The active remaining M1 work is to add bounded D1 current-state overlay upserts and deletion tombstones, integrate base-plus-overlay current reads, wire scheduled incremental collection, catch up contiguously from the ledger after the active base, and verify continuous Devnet monitoring.

The earlier D1-only complete row-per-object current-state snapshot design was stopped after measured projection exceeded the project resource safety envelope. The active architecture uses a verified immutable base read model plus bounded D1 incremental history and current-state overlay.

Mainnet remains disabled.

See [`docs/implementation-status.md`](docs/implementation-status.md) for the exact public implementation state and blockers, and [`docs/development-roadmap.md`](docs/development-roadmap.md) for target dates, dependency order, and milestone exit conditions.

## Documentation

Start with [`docs/README.md`](docs/README.md).

Key documents:

- [`docs/product-spec.md`](docs/product-spec.md)
- [`docs/architecture.md`](docs/architecture.md)
- [`docs/data-model.md`](docs/data-model.md)
- [`docs/collector-design.md`](docs/collector-design.md)
- [`docs/resource-envelope.md`](docs/resource-envelope.md)
- [`docs/development-roadmap.md`](docs/development-roadmap.md)
- [`docs/implementation-status.md`](docs/implementation-status.md)
- [`docs/decision-log.md`](docs/decision-log.md)

## Working rule

All implementation must follow the repository specifications and development roadmap. Contributors and coding agents must read [`AGENTS.md`](AGENTS.md) before making changes.

Every implementation PR must update `docs/implementation-status.md` and must update the roadmap, specifications, resource envelope, or decision log when the change affects them.

## Initial product boundary

- Devnet first
- Mainnet disabled until explicitly approved
- Read-only
- No wallet connection
- No transaction signing or submission
- XRP, IOU, and MPT kept distinct
- No invented LTV, collateral value, credit score, risk score, or cross-asset TVL
- No stale or partial data presented as fresh