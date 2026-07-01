# Implementation status

Last updated: 2026-07-01.

## Current milestone

**M1 — Current-state collector**

## Completed

### M0 — Foundation and specification lock

- repository and source-of-truth documentation;
- product, architecture, data, status, asset, collector, testing, resource, positioning, roadmap, and decision documents;
- pinned TypeScript, React/Vite, Hono Worker, D1, test, and CI skeleton;
- Mainnet-fail-closed runtime configuration;
- read-only foundation UI and API boundary;
- frozen-lockfile CI with lint, type-check, unit, migration, build, and browser checks.

### M1 network and epoch foundation

- canonical LendingProtocol and SingleAssetVault amendment identifiers;
- validated XRPL JSON-RPC reads with timeout and endpoint fallback;
- validated-ledger, server-version, server-state, and complete-ledger parsing;
- Devnet reset-signal detection for ledger rewind and same-index hash change;
- deterministic initial epoch and synchronization state planning;
- `network_epochs` and `sync_state` D1 migration;
- scheduled status refresh and D1 persistence;
- D1-backed read-only `/api/status`;
- explicit amendment, freshness, cursor, error, and reset fields;
- unit tests and local D1 migration validation.

## Current validation

- frozen-lockfile install: passed;
- lint: passed;
- type-check: passed;
- unit tests: passed;
- local D1 migration apply: passed;
- build: passed;
- browser smoke test: passed.

## Next work

### Asset normalization

- XRP normalization;
- IOU currency-and-issuer identity;
- MPT issuance identity and metadata resolution;
- exact decimal amount utilities;
- rate-unit and Ripple epoch conversion;
- missing and complete metadata fixtures;
- API-safe asset serialization;
- enforcement that unlike assets cannot be aggregated.

### Following work — current object scanner and collector benchmark

- complete marker traversal for Vault, LoanBroker, and Loan;
- current-state projections and relationship checks;
- partial-scan failure behavior;
- CPU, request, D1, storage, and catch-up measurements;
- collector runtime and cadence selection.

## Known open questions

| Question | Required evidence | Assigned point |
|---|---|---|
| Which collector runtime and cadence provide adequate operating margin? | Production-shaped CPU, request, storage, and catch-up measurements | Current object scanner / Checkpoint A |
| What exact schedule-state boundary labels should be public? | Tests against due-time and grace-end boundaries | Status engine |
| What is the confirmed successful overpayment transaction shape? | Isolated Devnet fixture and validated metadata | Loan lifecycle |
| How should each deletion reason be classified? | Transaction and DeletedNode fixtures | Deleted-object archive |
| What MPT metadata is reliably available from public RPC? | Live and fixture tests | Asset normalization |
| Which additional signals reliably confirm a Devnet reset? | Simulation, independent confirmation, and live observation | Reset hardening |

## Active design decisions

- a single reset signal produces `reset_suspected` rather than automatic epoch rollover;
- amendment and server values for a snapshot come from one endpoint;
- the public status endpoint reads D1 only and does not mutate state or call XRPL on demand;
- production collection activation and real production bindings remain disabled until approved.

## Current blockers

None.

## Risks being watched

- scheduled Worker CPU allowance may be insufficient for the full collector;
- Devnet can reset and erase current public state;
- one reset signal can be transient and requires confirmation;
- public RPC behavior and available history may change;
- MPT metadata may be incomplete;
- Mainnet activation timing is unknown;
- direct comparators may expand lifecycle-history coverage.

## Operational rule

Every future implementation PR updates this file with the current milestone, completed work, next work, blockers, open questions, and material schedule changes.
