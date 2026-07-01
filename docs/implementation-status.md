# Implementation status

Last updated: 2026-07-01.

## Current milestone

**M1 — Current-state collector**

## Active branch

`collector/current-state-collection`

## Current work

Roadmap PR 6: validated-ledger current-state traversal, projection normalization, resumable snapshot staging, and Checkpoint A measurements.

Implemented on the active branch:

- canonical binary decoding through the pinned XRPL codec;
- one unfiltered ledger pass that classifies Vault, LoanBroker, and Loan locally;
- a resumable `scanCurrentStateBatch` API with exact marker continuation;
- bounded pages and object counts per invocation;
- fixed ledger hash and ledger index validation;
- repeated-marker, malformed-binary, duplicate-ID, and partial-run failure checks;
- XRPL omitted-zero handling for current projections;
- nullable terminal Loan due dates without invented timestamps;
- rejection of Loans that retain payments without a next due date;
- Loan flag decoding and relationship-integrity checks;
- D1 snapshot metadata with `building`, `active`, `failed`, and `superseded` states;
- D1 activation and cursor advancement only after a complete external manifest exists;
- external shard and manifest contracts for current-state object storage;
- machine-readable Devnet benchmark evidence;
- unit tests for pagination, exact marker resume, terminal Loan normalization, projection normalization, and activation ordering.

## Completed

### M0 — Foundation and specification lock

- repository and source-of-truth documentation;
- product, architecture, data, status, asset, collector, testing, resource, positioning, roadmap, and decision documents;
- pinned TypeScript, React/Vite, Hono Worker, D1, test, and CI skeleton;
- Mainnet-fail-closed runtime configuration;
- read-only foundation UI and API boundary;
- frozen-lockfile CI with lint, type-check, unit, migration, build, and browser checks.

### M1 network and epoch foundation

- validated Devnet status collection;
- amendment, ledger, epoch, reset-signal, and freshness handling;
- D1-backed read-only `/api/status`;
- scheduled Worker status refresh.

### M1 asset normalization

- canonical XRP, issuer-aware IOU, and MPT issuance identities;
- exact decimal and scaled-integer arithmetic;
- MPT metadata and flag resolution;
- rate and Ripple epoch conversion;
- API-safe serialization;
- merged PR #5.

## Checkpoint A evidence

### Bounded single-pass probe

At validated Devnet ledger `3291171`, 25 binary pages produced:

- 25 requests;
- 51,200 decoded ledger objects;
- 3,402 Lending-related objects;
- 2,048 decoded objects per page;
- 6.858 seconds elapsed in the recorded probe;
- approximately 11.3 MB process-heap growth.

### Complete filtered reference scans

Separate measurement runs completed:

- Vault: 789,254 objects over 11,481 requests, approximately 835 seconds;
- LoanBroker: 522,784 objects over 11,481 requests, approximately 855 seconds.

The measurements demonstrate that full bootstrap is a large historical-state operation rather than a normal scheduled status refresh.

## Checkpoint A decision

- **Scheduled Worker full bootstrap is not approved.** The scheduled Worker remains status-only until incremental collection is implemented.
- **Three separate filtered traversals are not approved.** They repeat the same global ledger marker path.
- **Full in-memory accumulation is not approved.** Current-state bootstrap must stream bounded pages.
- **D1 is metadata and active-pointer storage only for bootstrap.** It does not hold every bootstrapped current object row.
- **Current-state objects use compressed external shards plus a manifest.** Provisioning remains disabled until runner and storage integration are reviewed.
- **Bootstrap runs through a resumable long-running runner.** The exact marker is persisted between bounded batches.
- **Incremental updates follow bootstrap.** They maintain the active snapshot after the initial complete snapshot exists.

## Current validation

The final PR #6 branch has passed:

- frozen-lockfile install;
- lint;
- type-check;
- unit tests;
- local D1 migrations;
- application build;
- browser smoke tests;
- controlled live Devnet binary traversal;
- live Vault, LoanBroker, and Loan projection normalization.

The live failure was caused by terminal Loan objects omitting zero-valued fields and removing `NextPaymentDueDate`. The projection now preserves these states as zero values plus a nullable due date while rejecting inconsistent non-terminal schedules.

## Remaining PR 6 work

- merge without enabling production bootstrap or provisioning object storage.

## Following work

### PR 6B — Bootstrap runner and storage integration

- long-running resumable execution;
- exact marker checkpoint persistence;
- bounded compressed shard generation;
- shard upload and retry behavior;
- complete manifest generation and verification;
- cleanup of incomplete bootstrap attempts;
- D1 active-pointer activation only after manifest verification;
- one preview-environment full bootstrap and resume test.

### PR 7 — Incremental validated-ledger collector

- cursor-based validated-ledger processing;
- recognized Lending transaction filtering;
- idempotent canonical event storage;
- bounded catch-up and retry behavior;
- raw-payload retention controls;
- integration with the active bootstrap snapshot and later replacement snapshots.

## Known open questions

| Question | Required evidence | Assigned point |
|---|---|---|
| Which long-running runner and object-store upload mechanism should execute bootstrap? | Resume, shard upload, manifest, and cleanup tests | PR 6B |
| What exact schedule-state boundary labels should be public? | Tests against due-time and grace-end boundaries | Status engine |
| What is the confirmed successful overpayment transaction shape? | Isolated Devnet fixture and validated metadata | Loan lifecycle |
| How should each deletion reason be classified? | Transaction and DeletedNode fixtures | Deleted-object archive |
| Which MPT metadata fields remain consistently available across live responses? | Live issuance fixtures | Asset enrichment follow-up |
| Which additional signals reliably confirm a Devnet reset? | Simulation and independent confirmation | Reset hardening |

## Active design decisions

- all current objects are tied to one validated ledger and epoch;
- markers are opaque and persisted unchanged;
- partial traversal counts are never published as complete totals;
- only a complete manifest can replace the previous active snapshot;
- the previous active snapshot survives failed replacement work;
- public runtime configuration does not enable full bootstrap;
- canonical identity and exact arithmetic from PR #5 apply to all projections;
- terminal zero-valued Loan fields may be omitted by XRPL binary serialization;
- `NextPaymentDueDate` is nullable only when the schedule has no remaining payment;
- Mainnet and real production storage bindings remain disabled until approved.

## Current blockers

None for completing and merging PR #6. Production bootstrap remains intentionally unprovisioned and is assigned to PR 6B.

## Operational rule

Every future implementation PR updates this file with current work, completed work, validation, decisions, blockers, and the next active implementation step.
