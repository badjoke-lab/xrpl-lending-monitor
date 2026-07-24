# XRPL Lending Monitor

Read-only monitoring, history, and audit tooling for the XRPL Lending Protocol.

The project covers the normal monitoring surface expected from a lending dashboard—overview, Vaults, Loan Brokers, Loans, activity, search, and network status—while preserving lifecycle history, deleted objects, state transitions, first-loss cover changes, provenance, and Devnet epochs within the collected evidence boundary.

## Current status

The project remains in P0 recovery on XRPL Devnet. Mainnet is disabled.

The active production design combines a verified immutable current-state base, a five-minute fast lane, a protected full-history path, a bounded D1 overlay, and hybrid immutable/live history reads. Current fast-lane freshness or contiguous ledger coverage must not be described as complete-history qualification by itself.

The ad-hoc complete-history soak issues #983 and #984 are invalid and are not release evidence. A new qualification window may begin only after the repository documents and implementation can prove queue continuity, validated-ledger continuity, semantic history completeness, current/history agreement, stable identities, retained audit evidence, and Free-operation resource compliance for the entire fixed window.

The next active unit is a source-backed implementation-to-spec audit of the five-minute fast lane, four-hour protected collector, immutable history boundary, live-tail merge, canonical overlay promotion, retention, reconciliation, and resource guards. No history scope reduction or abandonment is approved.

See [`docs/implementation-status.md`](docs/implementation-status.md) for the controlling status and next actions.

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
- [`docs/observatory-roadmap.md`](docs/observatory-roadmap.md)
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
