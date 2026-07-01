# Implementation status

Last updated: 2026-07-01.

## Current milestone

**M1 — Current-state collector**

## Active branch

`collector/current-state-collection`

## Current work

Roadmap PR 6: marker-complete Vault, LoanBroker, and Loan collection, normalized current projections, staged D1 snapshots, and collector measurements.

Implemented on the active branch:

- `ledger_data` scans fixed to one validated ledger hash and index;
- opaque marker preservation across pages;
- explicit page and request ceilings;
- fail-closed behavior for page failure, ledger movement, invalid object type, and incomplete scans;
- duplicate object-ID detection;
- Vault, LoanBroker, and Loan field normalization;
- direct Loan flag decoding for active, impaired, defaulted, and overpayment support;
- Vault → LoanBroker → Loan relationship validation;
- Broker OwnerCount reconciliation;
- staged D1 snapshot schema with `building`, `active`, `failed`, and `superseded` states;
- snapshot rows hidden from current reads until full activation;
- bounded D1 write batches;
- cursor advancement only in the final activation batch;
- explicit request, page, object, and elapsed-time metrics;
- scheduled collection guarded by `CURRENT_STATE_COLLECTION_ENABLED=false` by default;
- fixture tests for marker preservation, page failure, ledger mismatch, duplicates, normalization, and relationship errors.

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

- canonical XRP, issuer-aware IOU, and MPT issuance identities;
- exact decimal and scaled-integer arithmetic;
- MPT metadata and flag resolution;
- rate and Ripple epoch conversion;
- API-safe serialization;
- clean CI and merged PR #5.

## Current validation

Pending clean PR #6 CI for:

- frozen-lockfile install;
- lint;
- type-check;
- unit tests;
- local D1 migration apply;
- build;
- browser smoke test.

Production-shaped live Devnet collection remains disabled until repository validation passes and Checkpoint A measurements are reviewed.

## Remaining PR 6 work

- fix any CI findings;
- add D1 repository and activation tests where practical;
- run a controlled live Devnet read benchmark;
- record response shapes, object counts, pages, requests, elapsed time, and available MPT metadata;
- measure Worker execution through deployment-compatible tooling;
- select the approved runtime and cadence at Checkpoint A;
- keep production collection disabled unless that decision explicitly enables it.

## Following work

### Incremental validated-ledger collector

- cursor-based validated-ledger processing;
- recognized Lending transaction filtering;
- idempotent canonical event storage;
- bounded catch-up and retry behavior;
- raw-payload retention controls.

## Known open questions

| Question | Required evidence | Assigned point |
|---|---|---|
| Which collector runtime and cadence provide adequate operating margin? | Production-shaped CPU, request, D1, storage, and catch-up measurements | PR 6 / Checkpoint A |
| What exact schedule-state boundary labels should be public? | Tests against due-time and grace-end boundaries | Status engine |
| What is the confirmed successful overpayment transaction shape? | Isolated Devnet fixture and validated metadata | Loan lifecycle |
| How should each deletion reason be classified? | Transaction and DeletedNode fixtures | Deleted-object archive |
| Which MPT metadata fields remain consistently available across live responses? | Current-object scan and live issuance fixtures | PR 6 benchmark |
| Which additional signals reliably confirm a Devnet reset? | Simulation, independent confirmation, and live observation | Reset hardening |

## Active design decisions

- all three object types are scanned at the same validated ledger;
- markers are opaque and passed through unchanged;
- partial scan counts are not published as complete totals;
- current projections become visible only after full scan, normalization, relationship validation, and persistence succeed;
- the previous active snapshot remains available after a failed replacement scan;
- collection ceilings are explicit runtime settings;
- collection activation is fail-closed by default;
- canonical identity and arithmetic rules from PR #5 apply to all projections;
- Mainnet and real production bindings remain disabled until approved.

## Current blockers

None.

## Risks being watched

- scheduled Worker CPU allowance may be insufficient for the full collector;
- a complete scan may require more requests or writes than one scheduled invocation should perform;
- Devnet can reset and erase current public state;
- public RPC response fields and metadata availability may change;
- Mainnet activation timing is unknown.

## Operational rule

Every future implementation PR updates this file with the current milestone, completed work, next work, blockers, open questions, and material schedule changes.
