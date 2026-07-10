# XRPL Lending Monitor

Read-only monitoring, history, and audit tooling for the XRPL Lending Protocol.

The project covers the normal monitoring surface expected from a lending dashboard—overview, Vaults, Loan Brokers, Loans, activity, search, and network status—while preserving lifecycle history, deleted objects, state transitions, first-loss cover changes, provenance, and Devnet epochs within the collected evidence boundary.

## Current status

M1 is complete. The T5 fixed-target recovery cutover is complete on XRPL Devnet. Production history runs in verified hybrid mode: immutable canonical history covers ledgers `3371676..3539657`, and bounded D1 live-tail continuation covers ledgers after that boundary. The active replacement current-state base is `devnet-3539657-747554dd57de` at ledger `3539657`.

Rolling checkpoint operationalization is active. Repeated non-production candidate cycles have retained remote candidate-pair rehearsal and read-only fail-closed preflight evidence. The rolling current-state base, incremental exact-index builder and linear merge path, bounded history read windows, reusable candidate workflow, and reusable read-only preflight workflow form the current operating path. Production promotion remains guarded and separate from candidate generation and preflight.

M5-5 real-data integration remains active. The retained production API cross-audit has passed, covering current/history consistency, lifecycle/current consistency, archive/current exclusion, live relationships, bounded exports and feeds, snapshot identity, Activity result classification, Cover & Loss availability, and freshness/lag behavior. Production-shaped browser evidence remains pending until collector freshness and D1 resource gates are adequate for representative evidence.

The durable browser-regression workflow is merged. It is designed to traverse 15 representative public routes only after a healthy collector preflight and the existing D1 headroom gate pass, then evaluate route coverage, required behaviors, technical findings, collector evidence, resource evidence, and bounded witness selection through a fail-closed exit evaluator.

Post-M5-5 M6 integrity/reset and runtime/resource baseline plans are prepared but not active. Explorer v1 pre-entry design preparation is also complete: the approved direction is a Guided Dashboard + bounded Relationship Explorer hybrid, with contract mapping, translation rules, content copy, relationship behavior, and a static API-shape audit documented before implementation begins.

The implementation order remains:

```text
rolling checkpoint operationalization
  -> M5-5 completion
  -> M6 integrity/reset baseline
  -> M6 runtime/resource guardrails
  -> Explorer v1
  -> remaining M6 release hardening
  -> public Devnet release and real soak
  -> XRPL Lending Observatory data foundation
  -> Observatory monitoring view
  -> Explorer v2
```

Mainnet remains disabled.

See [`docs/implementation-status.md`](docs/implementation-status.md) for the detailed public implementation record and blockers, [`docs/development-roadmap.md`](docs/development-roadmap.md) for milestone dependency order, and [`docs/observatory-roadmap.md`](docs/observatory-roadmap.md) for the approved Explorer and XRPL Lending Observatory expansion sequence.

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
