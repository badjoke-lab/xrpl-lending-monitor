# Implementation status

Last updated: 2026-07-01.

## Current milestone

**M1 — Current-state collector**

## Active branch

`collector/bootstrap-runner-storage`

## Current work

Stacked PR #7 implements roadmap PR 6B: resumable bootstrap execution, durable checkpoints, compressed object shards, verified manifests, D1 activation, and fail-closed cleanup planning. PR #6 remains its fully validated base until the merge operation is accepted.

Implemented on the active branch:

- bootstrap identity locked to snapshot, epoch, endpoint, ledger index, ledger hash, and object prefix;
- persisted exact-marker checkpoints with global page sequencing;
- bounded calls into `scanCurrentStateBatch`;
- deterministic gzip JSON shard serialization;
- durable shard write before checkpoint advancement;
- SHA-256 digests for every shard and the manifest;
- idempotent R2 object writes with size and digest checks;
- D1 checkpoint migration and validated checkpoint adapter;
- checkpoint identity and sequence validation;
- terminal scan checkpointing before manifest publication;
- manifest write and read-after-write digest verification;
- digest-bound, idempotent D1 active-snapshot activation;
- checkpoint retention when manifest verification fails;
- checkpoint removal only after activation succeeds;
- D1 and R2 bootstrap execution wiring;
- cleanup rejection while a checkpoint exists or a snapshot is building or active;
- prefix-scoped cleanup planning with protected active or rollback keys;
- bounded deletion batches;
- tests for activation, exact-marker resume, shard ordering, storage idempotency, manifest retry without rescanning, checkpoint persistence, gzip payloads, cleanup safety, and ledger mismatch rejection.

## Completed

### M0 — Foundation and specification lock

- repository and source-of-truth documentation;
- product, architecture, data, status, asset, collector, testing, resource, positioning, roadmap, and decision documents;
- pinned TypeScript, React/Vite, Hono Worker, D1, test, and CI skeleton;
- Mainnet-fail-closed runtime configuration;
- read-only foundation UI and API boundary.

### M1 network, epoch, and asset foundation

- validated Devnet status collection;
- amendment, ledger, epoch, reset-signal, and freshness handling;
- D1-backed read-only `/api/status`;
- scheduled Worker status refresh;
- canonical XRP, issuer-aware IOU, and MPT identities;
- exact decimal and scaled-integer arithmetic;
- MPT metadata, rate, and Ripple epoch normalization.

### PR 6 validated current-state scanner

- one unfiltered binary ledger traversal with local Vault, LoanBroker, and Loan classification;
- exact marker continuation and fixed validated-ledger checks;
- bounded pages and objects per invocation;
- zero-omitted terminal Loan normalization;
- relationship checks and staged snapshot metadata;
- Checkpoint A benchmark evidence and architecture decision;
- final CI and live Devnet benchmark passed.

## Checkpoint A decision

- scheduled Worker full bootstrap is not approved;
- repeated filtered global traversals are not approved;
- full in-memory accumulation is not approved;
- bootstrap uses a resumable long-running runner;
- object data uses bounded compressed shards and a verified manifest;
- D1 stores snapshot metadata, checkpoints, manifest digest, and the active pointer;
- incremental updates follow the initial active snapshot.

## Current validation

PR #6 final head passed:

- frozen-lockfile install;
- lint;
- type-check;
- unit tests;
- local D1 migrations;
- application build;
- browser smoke test;
- live Devnet binary traversal and projection normalization.

PR #7 current implementation head passed:

- frozen-lockfile install;
- lint;
- type-check;
- unit tests including cleanup safety;
- all local D1 migrations including bootstrap checkpoints;
- application build;
- browser smoke test;
- live Devnet binary traversal and projection normalization.

## Remaining PR 6B work

- add a controlled preview bootstrap workflow with no committed credentials;
- run an interruption-and-resume preview test;
- select the failed-prefix retention window from preview evidence;
- provision production storage only after preview evidence is accepted.

## Following work

### Incremental validated-ledger collector

- cursor-based validated-ledger processing;
- recognized Lending transaction filtering;
- idempotent canonical event storage;
- bounded catch-up and retry behavior;
- raw-payload retention controls;
- integration with the active bootstrap snapshot.

## Known open questions

| Question | Required evidence | Assigned point |
|---|---|---|
| What retention window should apply to failed bootstrap prefixes? | Preview interruption, resume, cleanup, and rollback measurements | PR 6B |
| What exact schedule-state boundary labels should be public? | Tests against due-time and grace-end boundaries | Status engine |
| What is the confirmed successful overpayment transaction shape? | Isolated Devnet fixture and validated metadata | Loan lifecycle |
| How should each deletion reason be classified? | Transaction and DeletedNode fixtures | Deleted-object archive |
| Which MPT metadata fields remain consistently available across live responses? | Live issuance fixtures | Asset enrichment follow-up |

## Active design decisions

- all current objects are tied to one validated ledger and epoch;
- markers are opaque and persisted unchanged;
- a checkpoint advances only after its shard is durable;
- partial traversal counts are never published as complete totals;
- only a digest-verified complete manifest can activate a snapshot;
- manifest retry does not rescan already durable final shards;
- R2 writes are idempotent by key, byte count, and SHA-256 digest;
- cleanup cannot run against resumable, building, or active snapshots;
- cleanup is snapshot-prefix scoped and preserves protected manifest references;
- the previous active snapshot survives failed replacement work;
- production bootstrap and Mainnet remain disabled until approved.

## Current blockers

No code or design blocker. Production credentials and provisioning remain intentionally absent until preview interruption, resume, cleanup, and activation evidence is recorded.

## Operational rule

Every implementation PR updates this file with current work, completed work, validation, decisions, blockers, and the next active implementation step.
