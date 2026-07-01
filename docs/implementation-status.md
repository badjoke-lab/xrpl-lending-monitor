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

### M1 asset normalization

- canonical XRP key and six-decimal drop display;
- issuer-aware IOU keys;
- 160-bit hexadecimal currency normalization;
- MPT issuance-ID normalization;
- exact decimal parsing, exponent normalization, comparison, addition, and subtraction;
- exact XRP and MPT scaled-integer handling;
- XRPL Amount and asset-descriptor normalization;
- MPT AssetScale, issuer, transfer-fee, metadata, and flag resolution;
- fallback behavior for missing or malformed MPT metadata;
- tenths-of-a-basis-point conversion;
- Ripple epoch conversion;
- API-safe asset and amount serialization;
- unit tests for identity separation, arithmetic, metadata, rates, serialization, and timestamps.

## Current validation

PR #5 clean branch validation passed:

- frozen-lockfile install: passed;
- lint: passed;
- type-check: passed;
- unit tests: passed;
- local D1 migration apply: passed;
- build: passed;
- browser smoke test: passed.

## Next work

### Current object scanner and collector benchmark

Planned branch: `collector/current-object-scanner`.

- complete marker traversal for Vault, LoanBroker, and Loan;
- current-state projections and relationship checks;
- asset normalization applied to Vault and Lending amounts;
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
| Which MPT metadata fields remain consistently available across live responses? | Current-object scan and live issuance fixtures | Current object scanner |
| Which additional signals reliably confirm a Devnet reset? | Simulation, independent confirmation, and live observation | Reset hardening |

## Active design decisions

- canonical identity is `XRP`, `IOU:<currency>:<issuer>`, or `MPT:<issuance_id>`;
- friendly labels and token metadata never change canonical identity;
- canonical arithmetic uses integer coefficients, decimal scales, and `BigInt` rather than binary floating point;
- unlike assets fail before aggregation;
- missing or invalid MPT metadata does not hide the issuance ID;
- a single reset signal produces `reset_suspected` rather than automatic epoch rollover;
- the public status endpoint reads D1 only and does not mutate state or call XRPL on demand;
- production collection activation and real production bindings remain disabled until approved.

## Current blockers

None.

## Risks being watched

- scheduled Worker CPU allowance may be insufficient for the full collector;
- Devnet can reset and erase current public state;
- one reset signal can be transient and requires confirmation;
- public RPC behavior and available history may change;
- MPT metadata may be incomplete or malformed;
- Mainnet activation timing is unknown;
- direct comparators may expand lifecycle-history coverage.

## Operational rule

Every future implementation PR updates this file with the current milestone, completed work, next work, blockers, open questions, and material schedule changes.
