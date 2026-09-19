# XRPL Lending Monitor

Read-only monitoring, current-state inspection, and historical audit tooling for the XRPL Lending Protocol.

## Current direction

The project is migrating to a **DB-less static-artifact architecture**.

The prior Cloudflare D1 / Queue / Worker-scheduled collector and Supabase recovery path is retired. New work follows:

```text
XRPL Devnet
  -> GitHub Actions bounded collector
  -> verified Current + History artifacts
  -> immutable publication + small active channel
  -> static React application
```

No canonical hosted database is part of the target runtime.

See:

- [Documentation index](docs/README.md)
- [Product specification](docs/product-spec.md)
- [DB-less runtime contract](docs/db-less-runtime-contract.md)
- [Architecture](docs/architecture.md)
- [Development roadmap](docs/development-roadmap.md)
- [Implementation status](docs/implementation-status.md)

## Product boundary

- Devnet first
- Read-only
- No wallet connection requirement
- No transaction signing or submission
- XRP, IOU, and MPT remain distinct
- No invented LTV, collateral value, credit score, risk score, or cross-asset TVL
- Current freshness and historical coverage are explicit
- Missing or uncollected data is never represented as complete

## Contribution rule

Read [AGENTS.md](AGENTS.md) and the active source-of-truth documents before implementation.

Historical D1/Supabase recovery documents remain available through Git history but are not implementation guidance.
