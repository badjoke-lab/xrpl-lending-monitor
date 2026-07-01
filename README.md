# XRPL Lending Monitor

Read-only monitoring, history, and audit tooling for the XRPL Lending Protocol.

The project covers the normal monitoring surface expected from a lending dashboard—overview, Vaults, Loan Brokers, Loans, activity, search, and network status—while preserving full lifecycle history, deleted objects, state transitions, first-loss cover changes, provenance, and Devnet epochs.

## Current status

Milestone 0: foundation and specification lock.

No collector, database, public API, or production UI has been implemented yet. The current work establishes the repository source of truth before implementation begins.

## Documentation

Start with [`docs/README.md`](docs/README.md).

Key documents:

- [`docs/product-spec.md`](docs/product-spec.md)
- [`docs/architecture.md`](docs/architecture.md)
- [`docs/data-model.md`](docs/data-model.md)
- [`docs/development-roadmap.md`](docs/development-roadmap.md)
- [`docs/implementation-status.md`](docs/implementation-status.md)
- [`docs/resource-envelope.md`](docs/resource-envelope.md)

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
