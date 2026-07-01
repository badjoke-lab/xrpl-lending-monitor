# Implementation status

Last updated: 2026-07-01.

## Current milestone

**M1 closeout — Current-state collector activation** and **M2 foundation — Incremental validated-ledger collector**.

M1 code foundations and controlled resume evidence are merged, but M1 has not exited because a complete isolated preview bootstrap has not yet been stored, verified, and activated. M2 foundation work may continue in parallel where it does not claim dependency on a real active snapshot.

## Canonical continuation point

GitHub pull request #10, `Add validated ledger history foundation`:

- branch: `collector/incremental-ledger-foundation`;
- base: `main`;
- verified head on 2026-07-01: `a5c52b303e57f070e8ea8872e3a96d0143548ac1`;
- state at verification: open, mergeable, not draft;
- normal CI and non-destructive incremental ledger read workflow passed at that head.

Always inspect the current pull-request head and checks before resuming; the values above are a recorded checkpoint, not permission to ignore newer GitHub state.

## Immediate work

Complete pull request #10 before beginning a separate AffectedNodes implementation:

1. re-read the current migration, incremental repository, parser, scanner, tests, and live-read workflow from the actual pull-request head;
2. close the concurrent cursor race so processed-ledger persistence, protocol-event persistence, and cursor advancement are atomic;
3. add rollback tests proving a cursor mismatch or mid-batch failure leaves no partial ledger or event rows;
4. preserve idempotent retry and already-committed behavior;
5. run full CI and the non-destructive live Devnet ledger-read workflow;
6. update the pull-request body and this file with exact evidence;
7. merge only after all required checks pass.

The recorded design direction is a D1-compatible fail-closed commit guard inside the same batch, or an equivalent mechanism proven by tests. Do not assume the design is already committed; inspect the branch first.

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

### Bootstrap runner and storage foundation

- D1 bootstrap checkpoints;
- deterministic compressed shards;
- SHA-256 shard and manifest digests;
- idempotent object-storage writes;
- verified manifest activation contract;
- D1 active-pointer update contract;
- fail-closed cleanup planning;
- full CI and live projection benchmark;
- PR #8 merged as `3695ef37d2fdd8ab9ddfe04f7989b1c6f2533fe0`.

### Controlled live bootstrap resume preview

- PR #9 merged as `ee6e065d6dc30e88eb3ce1433a8787c933f9d7ab`;
- fixed Devnet ledger `3293119` with hash `A607447D13F7D03E11AE7895CCAA5AB16D3C051EF4421042043AFA8E6454EC85`;
- batch 1: one request, 2,048 decoded objects, 124 Lending objects, 33,213 compressed bytes;
- batch 2 cumulative: two requests, 4,096 decoded objects, 261 Lending objects, 70,219 compressed bytes;
- global shard pages remained `[1, 2]`;
- exact continuation marker advanced;
- lifecycle initialization ran once;
- the partial traversal did not activate a snapshot;
- normal CI, current-state live benchmark, and resume workflow passed.

## Checkpoint A decision

- scheduled Worker full bootstrap is not approved;
- repeated filtered global traversals are not approved;
- full in-memory accumulation is not approved;
- bootstrap uses a resumable long-running runner;
- object data uses bounded compressed shards and a verified manifest;
- D1 stores snapshot metadata, checkpoints, manifest digest, and active pointer;
- incremental updates follow an initial active snapshot.

## M1 remaining work

1. confirm the approved boundary for isolated preview D1 and R2 access;
2. connect the existing adapters only when that access is available;
3. run a longer or complete fixed-ledger preview bootstrap;
4. intentionally interrupt and resume against the same ledger;
5. verify shard retry, manifest retry, cleanup safety, activation, and rollback;
6. measure request count, runtime, memory, storage, and recovery behavior;
7. select and document the failed-prefix retention window from evidence;
8. provision production-shaped storage only at the applicable human approval gate;
9. complete a full marker traversal, verify its manifest, and activate the initial snapshot.

M1 exits only when a complete marker-aware bootstrap is stored, verified, and active.

## M2 ordered work after the incremental foundation

1. AffectedNodes normalization;
2. Loan lifecycle engine;
3. deleted-object archive;
4. cover, debt, and loss tracking;
5. status engine and reconciliation;
6. Checkpoint B history-completeness decision.

Then continue with M3 Public API, M4 baseline UI, M5 differentiated audit UI, and M6 hardening and public Devnet release in `docs/development-roadmap.md` order.

## Current validation

Merged `main` through PR #9 has passed frozen install, lint, type-check, unit tests, local D1 migrations, build, browser smoke, live current-state projection, and controlled resume checks.

At the recorded PR #10 head, the incremental parser read Devnet ledger `3293550`, verified its ledger identity and transaction order, observed two transactions with types `Payment` and `MPTokenAuthorize`, and found zero recognized Lending transactions. This is parser and continuity evidence, not evidence of complete historical collection.

## Known open questions

| Question | Required evidence | Assigned point |
|---|---|---|
| What retention window should apply to failed bootstrap prefixes? | Longer preview, cleanup, storage, and rollback measurements | M1 preview bootstrap |
| What exact schedule-state boundary labels should be public? | Tests against due-time and grace-end boundaries | M2 status engine |
| What is the confirmed successful overpayment transaction shape? | Isolated Devnet fixture and validated metadata | M2 Loan lifecycle |
| How should each deletion reason be classified? | Transaction and DeletedNode fixtures | M2 deleted-object archive |
| Which MPT metadata fields remain consistently available across live responses? | Live issuance fixtures | Asset enrichment follow-up |

## Active design decisions

- all current objects are tied to one validated ledger and epoch;
- markers are opaque and persisted unchanged;
- a checkpoint advances only after its shard is durable;
- partial traversal counts are never published as complete totals;
- only a digest-verified complete manifest can activate a snapshot;
- manifest retry does not rescan durable final shards;
- cleanup cannot run against resumable, building, protected, or active snapshots;
- processed-ledger persistence, canonical-event persistence, and cursor advancement must be atomic;
- production bootstrap and Mainnet remain disabled until approved.

## Current blockers

No known code blocker is recorded for completing pull request #10.

A real isolated preview bootstrap depends on approved external preview access. That dependency does not block local implementation, tests, documentation, or independent incremental-history work.

## Codex continuation documents

- `docs/codex-goal.md` contains the durable project objective;
- `docs/codex-master-task.md` contains the ordered end-to-end execution task;
- root `AGENTS.md` defines mandatory operating rules and human approval gates.

## Operational rule

Every implementation pull request updates this file with current work, completed work, validation, decisions, blockers, and the first active next step. Before an execution limit ends a session, commit coherent progress and leave enough exact GitHub state for the next session to resume without conversation history.
