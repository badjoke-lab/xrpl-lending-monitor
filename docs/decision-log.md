# Decision log

This file records accepted product and architecture decisions. New material decisions must be appended with date, status, context, decision, and consequences.

## D-001 — Independent repository

- Date: 2026-07-01
- Status: accepted

### Context

Early protocol tests were temporarily executed through the XRPL Group Pay repository.

### Decision

XRPL Lending Monitor is implemented only in `badjoke-lab/xrpl-lending-monitor`.

### Consequences

- no runtime or code dependency on Group Pay;
- no Lending collector changes merged into Group Pay;
- separate CI, Cloudflare resources, D1 database, and deployment configuration.

## D-002 — Read-only initial product

- Date: 2026-07-01
- Status: accepted

### Decision

The initial release contains no wallet connection, signing, deposit, withdrawal, borrowing, repayment, or transaction-submission capability.

### Consequences

The product is an observer and audit layer, reducing security and operational risk.

## D-003 — Baseline monitor plus differentiated audit layer

- Date: 2026-07-01
- Status: accepted

### Decision

The project must implement complete baseline monitoring pages before relying on lifecycle and archive features as differentiation.

### Consequences

Overview, Vault, Broker, Loan, activity, search, and network pages are mandatory. Lifecycle, deletion archives, cover history, epochs, and provenance are additive.

## D-004 — Devnet first, Mainnet disabled

- Date: 2026-07-01
- Status: accepted

### Decision

Initial collection and public release target XRPL Lending Devnet. Mainnet code paths remain disabled until formal activation and starting-ledger approval.

### Consequences

All records include network and epoch. Mainnet cannot be enabled by an accidental endpoint change.

## D-005 — Separate on-ledger and schedule status

- Date: 2026-07-01
- Status: accepted

### Decision

A Loan has separate `on_ledger_status` and `schedule_status`.

### Consequences

A deadline-derived default-eligible state is never presented as an actual default without on-ledger evidence.

## D-006 — Asset identity is canonical and asset-separated

- Date: 2026-07-01
- Status: accepted

### Decision

XRP, each IOU currency+issuer pair, and each MPT issuance ID are separate assets. Initial release has no price conversion layer.

### Consequences

No synthetic cross-asset TVL. Aggregates are grouped by canonical asset key.

## D-007 — Historical events preserve deleted objects

- Date: 2026-07-01
- Status: accepted

### Decision

Current-state tables are projections. Deleted objects remain in archived and lifecycle tables.

### Consequences

The product can search Loans, Brokers, and Vaults after they disappear from the current ledger.

## D-008 — Cloudflare-first architecture with a benchmark gate

- Date: 2026-07-01
- Status: accepted

### Decision

Use React/Vite, Cloudflare Workers, and D1 as the target architecture. Do not assume the scheduled collector fits the Workers Free 10 ms CPU allowance until measured.

### Consequences

PR 6 must benchmark production-shaped collection. A free GitHub Actions collector or reduced cadence is an allowed fallback only after a documented checkpoint decision.

## D-009 — Documentation controls implementation

- Date: 2026-07-01
- Status: accepted

### Decision

`docs/` and `AGENTS.md` are the source of truth. Every implementation PR updates `docs/implementation-status.md`, and material changes update the relevant specification and this log.

### Consequences

Conversation-only decisions and obsolete mockups cannot silently control implementation.

## D-010 — Pinned modern TypeScript toolchain

- Date: 2026-07-01
- Status: accepted

### Context

The project needs one reproducible toolchain for the React interface, Cloudflare Worker, tests, and CI before collector implementation starts.

### Decision

Use Node.js 24 LTS and pnpm 11 with exact package versions. The initial stack is TypeScript, React, Vite, Hono, Wrangler, Vitest, Playwright, and ESLint.

### Consequences

- runtime and package-manager versions are checked into the repository;
- dependency versions are exact rather than ranged;
- CI must prove that the selected versions interoperate before merge;
- a generated pnpm lockfile must be committed after dependency resolution succeeds.

## D-011 — Fail-closed deployment boundary

- Date: 2026-07-01
- Status: accepted

### Context

Mainnet support is not approved, and no production D1 database has been provisioned.

### Decision

Runtime configuration accepts only Devnet, requires `MAINNET_ENABLED=false`, and rejects insecure RPC endpoints. The checked-in D1 database ID remains a zero-value placeholder until explicit provisioning.

### Consequences

- accidental Mainnet activation fails at runtime;
- the repository cannot silently target a real production D1 database;
- provisioning and deployment require a later documented approval and configuration change.

## D-012 — Status reads are separated from network writes

- Date: 2026-07-01
- Status: accepted

### Context

A public status request should not depend on XRPL response time or mutate collection state.

### Decision

The scheduled collector reads XRPL and writes network status to D1. The public `/api/status` endpoint reads the latest committed D1 state only.

### Consequences

- public API latency is independent of live XRPL latency;
- status remains available during an RPC outage with explicit staleness and error fields;
- public read traffic cannot trigger additional XRPL calls or D1 writes;
- collector health and data freshness are visible separately.

## D-013 — Reset signals require confirmation

- Date: 2026-07-01
- Status: accepted

### Context

A lower ledger index or a changed hash at the same index can indicate a Devnet reset, but one observation is not sufficient to destroy or roll over canonical state.

### Decision

Initial reset detection changes sync state to `reset_suspected`. It does not archive the current epoch or create a new one automatically.

### Consequences

- previous epoch data remains untouched after one suspicious observation;
- later reset-hardening work must confirm the signal through repeated or independent evidence;
- current-object collection pauses rather than mixing potentially different epochs.
