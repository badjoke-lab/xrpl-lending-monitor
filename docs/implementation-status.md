# Implementation status

Last updated: 2026-07-02.

## Current milestone

**M1 closeout — Current-state collector activation** and **M2 event history — Loan lifecycle engine**.

M1 code foundations and controlled resume evidence are merged, but M1 has not exited because a complete isolated preview bootstrap has not yet been stored, verified, and activated. M2 foundation work may continue in parallel where it does not claim dependency on a real active snapshot.

## Canonical continuation point

GitHub pull request #12, `Normalize AffectedNodes object changes`, merged by squash as `1b04dfaa308d670e30ac5275e444559c5f2bcf75`.

Active local branch for the next roadmap unit:

- branch: `collector/loan-lifecycle-engine`;
- base: `main` at `1b04dfaa308d670e30ac5275e444559c5f2bcf75`;
- roadmap unit: M2 PR 9, Loan lifecycle engine;
- current state: local implementation and validation complete; pull request not opened yet.

Always inspect the current pull-request head and checks before resuming; the values above are a recorded checkpoint, not permission to ignore newer GitHub state.

## Immediate work

Complete the Loan lifecycle engine pull request before beginning the deleted-object archive:

1. push `collector/loan-lifecycle-engine`;
2. open a focused PR with exact validation and live-read evidence;
3. resolve CI or review findings without weakening invariants;
4. merge only after required checks pass and the branch is current.

The first incomplete action is opening the Loan lifecycle engine pull request.

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

### Codex autonomous execution documentation

- PR #11 merged by squash as `52d32424393bfa5c99f7279b99f84104a73dab79`;
- root `AGENTS.md`, `docs/codex-goal.md`, `docs/codex-master-task.md`, `docs/implementation-status.md`, and `docs/README.md` are now in canonical `main`;
- PR #11 CI `quality` passed before merge;
- local validation for PR #11 passed `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm check`, and `pnpm test:e2e`.

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

Merged `main` through PR #11 has passed frozen install, lint, type-check, unit tests, local D1 migrations, build, browser smoke, live current-state projection, controlled resume checks, and the PR #11 documentation CI check.

At the recorded PR #10 head, the incremental parser read Devnet ledger `3293550`, verified its ledger identity and transaction order, observed two transactions with types `Payment` and `MPTokenAuthorize`, and found zero recognized Lending transactions. This is parser and continuity evidence, not evidence of complete historical collection.

Current local PR #10 validation after the D1 commit guard update:

- `pnpm exec vitest run src/worker/repositories/incremental-ledger-repository.test.ts src/collector/incremental/scan-validated-ledgers.test.ts`: 14 tests passed;
- `pnpm lint && pnpm typecheck`: passed;
- `pnpm test`: 20 test files passed, 3 skipped; 91 tests passed, 3 skipped;
- clean local D1 migration reset by removing ignored `.wrangler/state/v3/d1`, then `pnpm db:migrate:local`: migrations `0001` through `0004` applied successfully;
- live Devnet ledger read: ledger `3297579`, hash `9504061A151987DAB42DCE162187B1277CEB81940EB50E4F40BB09F3CCBCD397`, parent hash `E6BB4B1BA0CDB5681D822339A1A3E42C1D249FA147D2C6980BD3D91E4CD34AC1`, transaction count `0`, observed transaction types `[]`, recognized Lending-event count `0`;
- `pnpm check`: passed;
- `pnpm test:e2e`: 1 Chromium smoke test passed.

GitHub PR #10 validation:

- `quality`: passed at head `6a3d4c6781d74a13f57f551b28a286b2b9b28b58`;
- `live-devnet-ledger`: passed at head `6a3d4c6781d74a13f57f551b28a286b2b9b28b58`;
- PR #10 had no review comments or unresolved review threads before merge.

Current local AffectedNodes normalization validation:

- `pnpm exec vitest run src/collector/incremental/affected-nodes.test.ts`: 9 tests passed;
- `pnpm exec vitest run src/collector/incremental/affected-nodes.test.ts src/worker/repositories/incremental-ledger-repository.test.ts`: 19 tests passed;
- `pnpm lint && pnpm typecheck`: passed;
- clean local D1 migration reset by removing ignored `.wrangler/state/v3/d1`, then `pnpm db:migrate:local`: migrations `0001` through `0005` applied successfully;
- `pnpm test`: 21 test files passed, 3 skipped; 100 tests passed, 3 skipped;
- `pnpm check`: passed;
- `pnpm test:e2e`: 1 Chromium smoke test passed;
- live Devnet ledger read: ledger `3298066`, hash `41A6526B16E353963FA011E5227556F6D3B0152F760133801751D12F975A8C91`, parent hash `D3825AF193583DDB86C0A19BCDE341AB50D8D646F22C7E2C93512ECCEB97B42E`, transaction count `0`, observed transaction types `[]`, recognized Lending-event count `0`.

GitHub PR #12 validation:

- `quality`: passed at head `dbd0b4b3e8738f885c67fac4374a47bce4f6268e`;
- `live-devnet-ledger`: passed at head `dbd0b4b3e8738f885c67fac4374a47bce4f6268e`;
- PR #12 had no review comments or unresolved review threads before merge.

Current local Loan lifecycle validation:

- `pnpm exec vitest run src/collector/incremental/loan-lifecycle.test.ts src/worker/repositories/incremental-ledger-repository.test.ts`: 18 tests passed.
- `pnpm lint && pnpm typecheck && pnpm test`: passed; 22 test files passed, 3 skipped; 108 tests passed, 3 skipped;
- clean local D1 migration reset by removing ignored `.wrangler/state/v3/d1`, then `pnpm db:migrate:local`: migrations `0001` through `0006` applied successfully;
- `pnpm check`: passed;
- `pnpm test:e2e`: 1 Chromium smoke test passed;
- live Devnet ledger read: ledger `3307901`, hash `1CA50D860533EAF90B2238F1C27476FD321548DD400142219C07E46E53DC3C2F`, parent hash `31FEC895939C0DDC662BDC94BD04EA8278CF014C9A92E93CDF45588ED67A5E1A`, transaction count `0`, observed transaction types `[]`, recognized Lending-event count `0`.

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
- incremental commits use a transient D1 guard row inside the same batch so cursor mismatch fails before processed-ledger or protocol-event rows can commit;
- production bootstrap and Mainnet remain disabled until approved.

## Current blockers

No known code blocker is recorded for completing the Loan lifecycle engine pull request.

A real isolated preview bootstrap depends on approved external preview access. That dependency does not block local implementation, tests, documentation, or independent incremental-history work.

## Codex continuation documents

- `docs/codex-goal.md` contains the durable project objective;
- `docs/codex-master-task.md` contains the ordered end-to-end execution task;
- root `AGENTS.md` defines mandatory operating rules and human approval gates.

## Operational rule

Every implementation pull request updates this file with current work, completed work, validation, decisions, blockers, and the first active next step. Before an execution limit ends a session, commit coherent progress and leave enough exact GitHub state for the next session to resume without conversation history.
