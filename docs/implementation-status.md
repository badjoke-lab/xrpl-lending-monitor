# Implementation status

Last updated: 2026-07-01.

## Current milestone

**M1 — Current-state collector**

## Active branch

`collector/bootstrap-resume-preview`

## Current work

Controlled live Devnet interruption-and-resume evidence for the merged bootstrap runner and storage integration.

Implemented and validated on the active branch:

- a two-batch live Devnet preview fixed to one validated ledger;
- first execution stops after one binary ledger page and persists the exact continuation marker;
- second execution resumes through the same bootstrap runner and advances to global shard page 2;
- deterministic gzip shard generation in both batches;
- evidence that lifecycle initialization occurs only once;
- evidence that a partial traversal does not attempt snapshot activation;
- machine-readable preview evidence uploaded by GitHub Actions;
- pull-request and manual `workflow_dispatch` execution without committed credentials.

## Completed

### M0 — Foundation and specification lock

- repository and source-of-truth documentation;
- product, architecture, data, status, asset, collector, testing, resource, positioning, roadmap, and decision documents;
- pinned TypeScript, React/Vite, Hono Worker, D1, test, and CI skeleton;
- Mainnet-fail-closed runtime configuration;
- read-only foundation UI and API boundary.

### M1 network, epoch, asset, and current-state scanner

- validated Devnet status collection;
- amendment, ledger, epoch, reset-signal, and freshness handling;
- D1-backed read-only `/api/status`;
- canonical XRP, issuer-aware IOU, and MPT normalization;
- exact arithmetic and time conversion;
- one unfiltered binary current-state traversal;
- exact marker continuation;
- terminal Loan zero-omission handling;
- Checkpoint A benchmark and runtime decision;
- PR #6 merged as `e15e465635ec28c26e527cad6b09bec3c231dc95`.

### Bootstrap runner and storage integration

- D1 bootstrap checkpoints;
- deterministic compressed shards;
- SHA-256 shard and manifest digests;
- idempotent R2 writes;
- verified manifest activation;
- D1 active pointer update;
- fail-closed cleanup planning;
- full CI and live projection benchmark passed;
- PR #8 merged as `3695ef37d2fdd8ab9ddfe04f7989b1c6f2533fe0`.

## Checkpoint A decision

- scheduled Worker full bootstrap is not approved;
- repeated filtered global traversals are not approved;
- full in-memory accumulation is not approved;
- bootstrap uses a resumable long-running runner;
- object data uses bounded compressed shards and a verified manifest;
- D1 stores snapshot metadata, checkpoints, manifest digest, and the active pointer;
- incremental updates follow the initial active snapshot.

## Current validation

Merged main has passed frozen install, lint, type-check, unit tests, all local D1 migrations, build, browser smoke, and live current-state projection checks.

The bootstrap resume preview passed at Devnet ledger `3293119` with hash `A607447D13F7D03E11AE7895CCAA5AB16D3C051EF4421042043AFA8E6454EC85`:

- batch 1: 1 request, 2,048 decoded objects, 124 Lending objects, 33,213 compressed bytes;
- batch 2 cumulative: 2 requests, 4,096 decoded objects, 261 Lending objects, 70,219 compressed bytes;
- global shard pages remained `[1, 2]`;
- the exact continuation marker advanced between batches;
- lifecycle initialization ran once;
- activation remained disabled for the partial traversal;
- normal CI, the current-state live benchmark, and the new resume workflow all passed.

## Remaining PR 6B work

- merge the successful live resume workflow;
- add real preview D1 and R2 bindings only after the credential and environment boundary is approved;
- run a longer preview bootstrap using those isolated bindings;
- set the failed-prefix retention window from the longer preview and rollback evidence;
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
| What retention window should apply to failed bootstrap prefixes? | Longer preview, cleanup, and rollback measurements | Bootstrap preview |
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
- cleanup cannot run against resumable, building, or active snapshots;
- production bootstrap and Mainnet remain disabled until approved.

## Current blockers

No code blocker. Real preview credentials and isolated bindings require an explicit environment decision before provisioning.

## Operational rule

Every implementation PR updates this file with current work, completed work, validation, decisions, blockers, and the next active implementation step.
