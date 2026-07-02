# Implementation status

Last updated: 2026-07-02.

## Current milestone

**M1 closeout — Current-state collector activation** and **M3 public API — Activity, search, and history API**.

M1 code foundations and controlled resume evidence are merged, but M1 has not exited because a complete isolated preview bootstrap has not yet been stored, verified, and activated. M2 history foundations, the Checkpoint B documentation decision, and the M3 core entity API shell are merged. M3 activity, search, and history API work is in progress.

## Canonical continuation point

GitHub pull request #18, `Add core entity API shell`, merged by squash as `86258cadc4c44891708de89db2d7c55868161dfd`.

Active local branch for the next roadmap unit:

- branch: `api/activity-history-api`;
- base: `main` at `86258cadc4c44891708de89db2d7c55868161dfd`;
- roadmap unit: M3 public API activity, search, and history API;
- current implementation commit: `97c2f98` (`feat: add activity history API`);
- current state: local implementation and validation complete; pull request not opened yet.

Always inspect the current pull-request head and checks before resuming; the values above are a recorded checkpoint, not permission to ignore newer GitHub state.

## Immediate work

Complete the M3 activity, search, and history API pull request:

1. push `api/activity-history-api`;
2. open a focused PR with the validation below;
3. merge only after required checks pass and the branch is current;
4. continue to the M3 exports and feeds unit from updated `main`.

The first incomplete action is pushing `api/activity-history-api`.

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

Merged in dependency order:

1. AffectedNodes normalization, PR #12, squash merge `1b04dfaa308d670e30ac5275e444559c5f2bcf75`;
2. Loan lifecycle engine, PR #13, squash merge `c33152db20c4624a90f08cbad8b13bc4ca6b3b96`;
3. deleted-object archive, PR #14, squash merge `b70f7ce540aafe35220fa06182eb52ca8b572652`;
4. cover, debt, and loss tracking, PR #15, squash merge `f8fd27e5d8bafa45e18b63475843e6b49b0d4aeb`;
5. status engine and reconciliation, PR #16, squash merge `9b83df5617890d1f1fb3d3cac7080ef57a4e9790`;
6. Checkpoint B history-completeness decision, PR #17, squash merge `04076722be7a37e95b5defbd82074d9474cb558c`.

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

GitHub PR #13 validation:

- `quality`: passed at head `1ea3deef688c6ca75e8cd2695c617e166d9cde6c`;
- `live-devnet-ledger`: passed at head `1ea3deef688c6ca75e8cd2695c617e166d9cde6c`;
- PR #13 had no review comments or unresolved review threads before merge.

Current local deleted-object archive validation:

- `pnpm exec vitest run src/collector/incremental/deleted-object-archive.test.ts src/worker/repositories/incremental-ledger-repository.test.ts`: 16 tests passed.
- `pnpm lint && pnpm typecheck && pnpm test`: passed; 23 test files passed, 3 skipped; 114 tests passed, 3 skipped;
- clean local D1 migration reset by removing ignored `.wrangler/state/v3/d1`, then `pnpm db:migrate:local`: migrations `0001` through `0007` applied successfully;
- `pnpm check`: passed;
- `pnpm test:e2e`: 1 Chromium smoke test passed;
- live Devnet ledger read: ledger `3308105`, hash `A0B402E3F818A5E8C221B5344622C69472AB26C858AA29B508409EF9C626E8D8`, parent hash `739B577CF6DA4B7721001B1BFFC9F9CE67700861563FBF14B66E817A7FB4BED7`, transaction count `1`, observed transaction types `[OracleSet]`, recognized Lending-event count `0`.

GitHub PR #14 validation:

- `quality`: passed at head `eb3b53b1a655ae80a115c45c8656f8de7257390e`;
- `live-devnet-ledger`: passed at head `eb3b53b1a655ae80a115c45c8656f8de7257390e`;
- PR #14 had no review comments or unresolved review threads before merge.

Current local cover/debt/loss validation:

- `pnpm exec vitest run src/collector/incremental/cover-debt-loss.test.ts src/worker/repositories/incremental-ledger-repository.test.ts`: 17 tests passed.
- `pnpm lint && pnpm typecheck && pnpm test`: passed; 24 test files passed, 3 skipped; 120 tests passed, 3 skipped;
- clean local D1 migration reset by removing ignored `.wrangler/state/v3/d1`, then `pnpm db:migrate:local`: migrations `0001` through `0008` applied successfully;
- `pnpm check`: passed;
- `pnpm test:e2e`: 1 Chromium smoke test passed;
- live Devnet ledger read: ledger `3308277`, hash `135F12108936C4CA352DE5504D640128F2CC64C4B5D03710C0062023715BD5FC`, parent hash `BD1F4D2F41B68A87322622BD11013493939607B28DFA95B5B4012794FA3FAEBB`, transaction count `0`, observed transaction types `[]`, recognized Lending-event count `0`.

GitHub PR #15 validation:

- `quality`: passed at head `bb27f09cb8a5d4825d6aeecebc4ea4dfbd1bd47b`;
- `live-devnet-ledger`: passed at head `bb27f09cb8a5d4825d6aeecebc4ea4dfbd1bd47b`;
- PR #15 had no review comments or unresolved review threads before merge.

Current local status/reconciliation validation:

- `pnpm exec vitest run src/domain/status/loan-status.test.ts src/collector/incremental/reconciliation.test.ts`: 9 tests passed;
- `pnpm lint && pnpm typecheck && pnpm test`: passed; 26 test files passed, 3 skipped; 129 tests passed, 3 skipped;
- `pnpm check`: passed;
- `pnpm test:e2e`: 1 Chromium smoke test passed;
- live Devnet ledger read: ledger `3308395`, hash `D29AB85FDB7E208895B85E118685CF5111B2E2846A138F323F4CF8825F942C9D`, parent hash `48FD9DB451AE63214847A069D24D1E6878B7B90D86829440414C151FFCDE9DC5`, transaction count `0`, observed transaction types `[]`, recognized Lending-event count `0`.

GitHub PR #16 validation:

- `quality`: passed at head `b655d2ce8fe5327dbee5c6f9a4dac2090f46a126`;
- `live-devnet-ledger`: passed at head `b655d2ce8fe5327dbee5c6f9a4dac2090f46a126`;
- PR #16 had no review comments or unresolved review threads before merge.

Checkpoint B decision:

- M2 data contracts are stable enough to begin M3 API contracts;
- public lifecycle completeness claims are not approved yet;
- active bootstrap snapshot, fixture-ledger replay, soak, and reconciliation evidence remain required before public release claims.

Current local M3 core entity API validation:

- implementation commit: `13092b6` (`feat: add core entity API shell`);
- status commit: `f340fb6` (`docs: record core entity API progress`);
- focused route test: `pnpm exec vitest run src/worker/core-api-routes.test.ts`: 4 tests passed;
- `pnpm typecheck`: passed;
- `pnpm lint`: passed;
- `pnpm check`: passed; 27 test files passed, 3 skipped; 133 tests passed, 3 skipped; local D1 migrations reported no pending migrations; build passed;
- `pnpm test:e2e`: 1 Chromium smoke test passed;
- live ledger evidence: not collected for this API-only branch because no collector, migration, or ledger-read behavior changed;
- branch: `api/core-entity-api`;
- PR #18, `Add core entity API shell`, passed `quality` at head `f340fb69e2aa104b37b22021e27345d4c0662763` and was squash-merged as `86258cadc4c44891708de89db2d7c55868161dfd`;
- PR #18 had no review comments or unresolved review threads before merge.

Current local M3 activity, search, and history API validation:

- implementation commit: `97c2f98` (`feat: add activity history API`);
- focused route test: `pnpm exec vitest run src/worker/history-api-routes.test.ts`: 6 tests passed;
- `pnpm typecheck`: passed;
- `pnpm check`: passed; 28 test files passed, 3 skipped; 139 tests passed, 3 skipped; local D1 migrations reported no pending migrations; build passed;
- `pnpm test:e2e`: 1 Chromium smoke test passed;
- live ledger evidence: not collected for this API-only branch because no collector, migration, or ledger-read behavior changed;
- branch: `api/activity-history-api`;
- pull request: not opened yet.

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

No known code blocker is recorded for completing the M3 activity, search, and history API pull request.

A real isolated preview bootstrap depends on approved external preview access. That dependency does not block local implementation, tests, documentation, or independent incremental-history work.

## Codex continuation documents

- `docs/codex-goal.md` contains the durable project objective;
- `docs/codex-master-task.md` contains the ordered end-to-end execution task;
- root `AGENTS.md` defines mandatory operating rules and human approval gates.

## Operational rule

Every implementation pull request updates this file with current work, completed work, validation, decisions, blockers, and the first active next step. Before an execution limit ends a session, commit coherent progress and leave enough exact GitHub state for the next session to resume without conversation history.
