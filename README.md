# XRPL Lending Monitor

Read-only monitoring, history, and audit tooling for the XRPL Lending Protocol.

The project covers the normal monitoring surface expected from a lending dashboard—overview, Vaults, Loan Brokers, Loans, activity, search, and network status—while preserving lifecycle history, deleted objects, state transitions, first-loss cover changes, provenance, and Devnet epochs within the collected evidence boundary.

## Current status

Milestone 1: post-cutover incremental continuation and exit verification.

The canonical-history and replacement-current-state cutover is complete on XRPL Devnet. Production history runs in verified hybrid mode: immutable canonical history covers ledgers `3371676..3432924`, and bounded D1 continuation covers ledgers after that boundary. The active replacement current-state base is `devnet-3432924-canonical` at ledger `3432924`.

Scheduled incremental collection is advancing contiguously after the replacement boundary with explicit cursor, lag, freshness, resource-usage, and failure reporting. Base-plus-overlay current reads, deletion tombstones, hybrid historical reads, exact history lookup, lifecycle history, archives, balance history, and the baseline UI are implemented.

The active M1 work is operational verification rather than architecture construction: continue bounded catch-up to the validated head, keep D1 usage and collector failures within the measured envelope, observe the remaining real post-boundary LoanPay and LoanManage lifecycle paths, verify activity/history/balance consistency, reach fresh zero-lag state, and complete the M1 exit review.

Mainnet remains disabled.

See [`docs/implementation-status.md`](docs/implementation-status.md) for the exact public implementation state and blockers, [`docs/development-roadmap.md`](docs/development-roadmap.md) for dependency order and milestone exit conditions, and [`docs/evidence/d1-safe-post-cutover-runtime-20260707.json`](docs/evidence/d1-safe-post-cutover-runtime-20260707.json) for the latest recorded post-cutover runtime evidence.

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
