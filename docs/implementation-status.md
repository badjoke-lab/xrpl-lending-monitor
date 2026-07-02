# Implementation status

Last updated: 2026-07-02.

## Current milestone

**M1 closeout — Current-state collector activation** and **M4-0 — UI specification and route architecture**.

M1 code foundations and controlled resume evidence are merged, but M1 has not exited because a complete isolated preview bootstrap has not yet been stored, verified, and activated. M2 history foundations and Checkpoint B are complete. M3 core, history/search, exports, and feeds are complete through PR #20. M4 code is paused behind the UI architecture gate.

## Canonical continuation point

GitHub pull request #20, `Add bounded activity exports`, merged by squash as `d0a8ef2e0b32345ed45284f37125fee714725a02`.

Two separate branches matter:

- UI WIP checkpoint branch: `ui/overview-status-shell`;
- UI WIP checkpoint commit: `aa623b9` (`wip: checkpoint M4 overview shell`);
- UI WIP state: pushed, working tree recorded clean, `pnpm typecheck` passed, `pnpm build` passed, no pull request opened;
- UI WIP boundary: functional first-pass API fetching exists, but the light simplified presentation is not the approved design and must not be merged as-is;
- active documentation branch: `planning/ui-architecture-roadmap`;
- documentation base: `main` at `d0a8ef2e0b32345ed45284f37125fee714725a02`;
- active roadmap unit: M4-0 UI specification and route architecture;
- active state: source-of-truth UI, page, route, responsive, project-page, Support, roadmap, architecture, Codex, and decision documents are being aligned before UI code resumes.

Always inspect the current pull-request head, branch heads, and checks before resuming; these values are recorded checkpoints, not permission to ignore newer GitHub state.

## Immediate work

Complete the M4-0 documentation pull request:

1. finish UI source-of-truth documents;
2. align product, architecture, roadmap, documentation index, decisions, Codex tasks, and this implementation status;
3. verify the branch contains documentation only;
4. open a focused pull request;
5. resolve documentation or CI findings without weakening product or integrity rules;
6. merge only after explicit authorization and required checks pass;
7. after merge, update `ui/overview-status-shell` from current `main` and implement M4-1 without merging the light WIP as-is.

The first incomplete action after this status update is reviewing the complete M4-0 branch diff and opening the focused documentation pull request.

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
- root `AGENTS.md`, `docs/codex-goal.md`, `docs/codex-master-task.md`, `docs/implementation-status.md`, and `docs/README.md` are canonical;
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

1. confirm the approved boundary for isolated preview D1 and object-storage access;
2. connect the existing adapters only when that access is available;
3. run a longer or complete fixed-ledger preview bootstrap;
4. intentionally interrupt and resume against the same ledger;
5. verify shard retry, manifest retry, cleanup safety, activation, and rollback;
6. measure request count, runtime, memory, storage, and recovery behavior;
7. select and document the failed-prefix retention window from evidence;
8. provision production-shaped storage only at the applicable human approval gate;
9. complete a full marker traversal, verify its manifest, and activate the initial snapshot.

M1 exits only when a complete marker-aware bootstrap is stored, verified, and active.

## M2 completion

Merged in dependency order:

1. incremental validated-ledger foundation, PR #10;
2. AffectedNodes normalization, PR #12, squash merge `1b04dfaa308d670e30ac5275e444559c5f2bcf75`;
3. Loan lifecycle engine, PR #13, squash merge `c33152db20c4624a90f08cbad8b13bc4ca6b3b96`;
4. deleted-object archive, PR #14, squash merge `b70f7ce540aafe35220fa06182eb52ca8b572652`;
5. cover, debt, and loss tracking, PR #15, squash merge `f8fd27e5d8bafa45e18b63475843e6b49b0d4aeb`;
6. status engine and reconciliation, PR #16, squash merge `9b83df5617890d1f1fb3d3cac7080ef57a4e9790`;
7. Checkpoint B history-completeness decision, PR #17, squash merge `04076722be7a37e95b5defbd82074d9474cb558c`.

## M3 completion

Merged in dependency order:

1. core entity API shell, PR #18, squash merge `86258cadc4c44891708de89db2d7c55868161dfd`;
2. activity, search, and history API, PR #19, squash merge `c74753f1041efd6554052d90796eb3d5485ea5b9`;
3. bounded exports and feeds, PR #20, squash merge `d0a8ef2e0b32345ed45284f37125fee714725a02`.

M3 APIs remain read-only and Devnet-only. Current entity collections remain explicitly unavailable until an active snapshot and public object-shard reader exist.

## Current validation history

Merged work through PR #20 has passed the applicable frozen install, lint, type-check, unit tests, local D1 migrations, build, browser smoke, contract, and bounded live-read workflows recorded below and in pull-request bodies.

### Incremental validated-ledger foundation

- focused repository and scanner tests: 14 passed;
- lint and type-check passed;
- unit suite: 91 passed, 3 skipped;
- local D1 migrations `0001` through `0004` applied from clean state;
- live Devnet ledger read verified ledger `3297579`, hash `9504061A151987DAB42DCE162187B1277CEB81940EB50E4F40BB09F3CCBCD397`, parent hash `E6BB4B1BA0CDB5681D822339A1A3E42C1D249FA147D2C6980BD3D91E4CD34AC1`, zero transactions, and zero recognized Lending events;
- `pnpm check` and one Chromium smoke test passed;
- PR #10 required checks passed and no unresolved review findings remained.

### AffectedNodes normalization

- focused tests: 19 passed;
- lint and type-check passed;
- local D1 migrations through `0005` applied from clean state;
- unit suite: 100 passed, 3 skipped;
- `pnpm check` and one Chromium smoke test passed;
- live Devnet ledger `3298066` verified with zero transactions and zero recognized Lending events;
- PR #12 required checks passed and no unresolved review findings remained.

### Loan lifecycle

- focused lifecycle and repository tests: 18 passed;
- lint, type-check, and unit suite passed; 108 tests passed, 3 skipped;
- local D1 migrations through `0006` applied from clean state;
- `pnpm check` and one Chromium smoke test passed;
- live Devnet ledger `3307901` verified with zero transactions and zero recognized Lending events;
- PR #13 required checks passed and no unresolved review findings remained.

### Deleted-object archive

- focused archive and repository tests: 16 passed;
- lint, type-check, and unit suite passed; 114 tests passed, 3 skipped;
- local D1 migrations through `0007` applied from clean state;
- `pnpm check` and one Chromium smoke test passed;
- live Devnet ledger `3308105` verified with one `OracleSet` transaction and zero recognized Lending events;
- PR #14 required checks passed and no unresolved review findings remained.

### Cover, debt, and loss

- focused balance-history and repository tests: 17 passed;
- lint, type-check, and unit suite passed; 120 tests passed, 3 skipped;
- local D1 migrations through `0008` applied from clean state;
- `pnpm check` and one Chromium smoke test passed;
- live Devnet ledger `3308277` verified with zero transactions and zero recognized Lending events;
- PR #15 required checks passed and no unresolved review findings remained.

### Status and reconciliation

- focused status and reconciliation tests: 9 passed;
- lint, type-check, and unit suite passed; 129 tests passed, 3 skipped;
- `pnpm check` and one Chromium smoke test passed;
- live Devnet ledger `3308395` verified with zero transactions and zero recognized Lending events;
- PR #16 required checks passed and no unresolved review findings remained.

### Checkpoint B decision

- M2 data contracts are stable enough for M3 API contracts;
- public lifecycle completeness claims are not approved yet;
- active bootstrap snapshot, fixture-ledger replay, soak, and reconciliation evidence remain required before public release claims.

### M3 core entity API

- focused route tests: 4 passed;
- type-check and lint passed;
- `pnpm check` passed; 133 tests passed, 3 skipped; no pending local D1 migrations; build passed;
- one Chromium smoke test passed;
- live ledger evidence was not collected because the branch changed only API behavior;
- PR #18 required checks passed and no unresolved review findings remained.

### M3 activity, search, and history API

- focused route tests: 6 passed;
- type-check passed;
- `pnpm check` passed; 139 tests passed, 3 skipped; no pending local D1 migrations; build passed;
- one Chromium smoke test passed;
- live ledger evidence was not collected because the branch changed only API behavior;
- PR #19 required checks passed and no unresolved review findings remained.

### M3 exports and feeds

- focused route tests: 9 passed;
- type-check passed;
- `pnpm check` passed; 142 tests passed, 3 skipped; no pending local D1 migrations; build passed;
- one Chromium smoke test passed;
- live ledger evidence was not collected because the branch changed only API behavior;
- PR #20 `quality` passed and the pull request was squash-merged as `d0a8ef2e0b32345ed45284f37125fee714725a02`.

### M4 WIP checkpoint

- branch: `ui/overview-status-shell`;
- commit: `aa623b9` (`wip: checkpoint M4 overview shell`);
- push: `origin/ui/overview-status-shell`;
- working tree was recorded clean after push;
- `pnpm typecheck`: passed;
- `pnpm build`: passed;
- focused UI tests were not run because no checkpoint-specific test existed;
- known mismatch: the current implementation is light and simplified and lacks the approved dark ledger-observatory shell, sidebar, and persistent context bar;
- merge status: not merge-ready and no pull request opened.

## M4-0 documentation scope

The active documentation unit defines and aligns:

- visual design system;
- information architecture;
- page map and canonical routes;
- page responsibilities and API dependencies;
- reusable component inventory;
- responsive and accessibility behavior;
- mockup interpretation;
- About, Methodology, Contact, API, and optional Support behavior;
- development roadmap and recalibrated target windows;
- Codex UI continuation task;
- decision log and documentation authority.

No UI code belongs in M4-0.

## Known open questions

| Question | Required evidence | Assigned point |
|---|---|---|
| What retention window should apply to failed bootstrap prefixes? | Longer preview, cleanup, storage, and rollback measurements | M1 preview bootstrap |
| What is the confirmed successful overpayment transaction shape? | Isolated Devnet fixture and validated metadata | M2/M6 fixture follow-up |
| How should each deletion reason be classified? | Transaction and DeletedNode fixtures | M5 archive UI and M6 integrity review |
| Which MPT metadata fields remain consistently available across live responses? | Live issuance fixtures | Asset enrichment follow-up |
| Which routing implementation should be used? | Static deployment, bundle, accessibility, deep-link, and maintenance review | M4-1 |
| What are the final Google Form and GitHub Issue URLs? | Explicit configuration approval | M4-6 / Checkpoint D |
| Will Support be enabled for initial release? | Approved address, network, asset, destination tag, QR payload, disclosures, and ownership | M4-6 / Checkpoint D |

## Active design decisions

- all current objects are tied to one validated ledger and epoch;
- markers are opaque and persisted unchanged;
- a checkpoint advances only after its shard is durable;
- partial traversal counts are never published as complete totals;
- only a digest-verified complete manifest can activate a snapshot;
- manifest retry does not rescan durable final shards;
- cleanup cannot run against resumable, building, protected, or active snapshots;
- processed-ledger persistence, canonical-event persistence, and cursor advancement are atomic;
- production bootstrap and Mainnet remain disabled until approved;
- UI uses the approved dark ledger-observatory direction;
- generated mockups do not define data;
- About, Methodology, Contact, and API are required baseline pages;
- Support is an optional disabled-by-default section at `/about#support`;
- USD conversion, oracle pricing, cross-asset totals, and unsupported operational metrics remain prohibited.

## Current blockers

No code blocker prevents completion of the M4-0 documentation pull request.

A real isolated preview bootstrap depends on approved external preview access. That dependency does not block documentation, UI implementation against explicit unavailable states, local tests, or independent audit UI work.

Contact external URLs are not yet approved. Support configuration is not yet approved. Their pages and components must therefore support unavailable or hidden states and must not publish placeholders.

## Codex continuation documents

- `docs/codex-goal.md` contains the durable project objective;
- `docs/codex-master-task.md` contains the ordered end-to-end execution task;
- `docs/codex-ui-task.md` contains the M4/M5 UI execution boundary and WIP checkpoint instructions;
- root `AGENTS.md` defines mandatory operating rules and human approval gates.

## Operational rule

Every implementation pull request updates this file with current work, completed work, validation, decisions, blockers, and the first active next step. Before an execution limit ends a session, commit coherent progress and leave enough exact GitHub state for the next session to resume without conversation history.
