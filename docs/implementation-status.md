# Implementation status

Last updated: 2026-07-02.

## Current milestone

**M1 closeout — Current-state collector activation** and **M4-1 — App shell, Overview, and Network Status**.

M0, M2, and M3 are complete. M4-0 UI specification and route architecture merged through PR #21. M1 code foundations are complete, but M1 has not exited because a complete isolated preview bootstrap has not yet been stored, verified, and activated.

## Canonical continuation point

Latest merged source-of-truth change:

- PR #21: `Define UI architecture and recalibrate M4–M6 roadmap`;
- squash merge: `0deae49e730f22b866674007b5a0d8d0eec564c3`;
- result: M4 UI implementation resumed under the approved UI source of truth.

Active M4-1 work:

- pull request: #22, `Add observatory Overview and Network Status UI`;
- branch: `ui/observatory-overview-status`;
- base: `main` at `0deae49e730f22b866674007b5a0d8d0eec564c3`;
- validated head before this status-only update: `12d9a6f8fbc564910d9ecdf73134b70d68710d34`;
- CI run: `28567044276`;
- CI result: all required `quality` steps passed;
- roadmap unit: M4-1 App shell, Overview, and Network Status;
- current state: implementation and validation complete; final PR state check and merge are the next actions.

Preserved superseded checkpoint:

- branch: `ui/overview-status-shell`;
- commit: `aa623b9` (`wip: checkpoint M4 overview shell`);
- state: pushed and preserved for audit;
- disposition: its API-fetching idea was reviewed, but the light simplified shell is superseded and must not be merged.

Always inspect current branch heads, open pull requests, and checks before resuming.

## Immediate work

Complete M4-1:

1. allow CI to rerun for this documentation-only validation record;
2. confirm PR #22 remains current, mergeable, and free of unresolved findings;
3. merge only after required checks pass and explicit authorization remains valid;
4. update `main` and begin M4-2 Vault UI from the new merge commit;
5. keep M1 isolated preview bootstrap as a separate parallel release dependency.

The first incomplete action is confirming the final PR #22 check and merge state.

## Completed milestones

### M0 — Foundation and specification lock

- repository operating rules and source-of-truth documents;
- pinned TypeScript, React/Vite, Hono Worker, D1, test, and CI foundation;
- fail-closed Devnet-only and read-only runtime boundary.

### M1 — Code foundations complete; activation pending

Completed foundations include:

- validated Devnet status collection;
- amendment, ledger, epoch, reset, and freshness handling;
- canonical XRP, IOU, and MPT identity and exact arithmetic;
- one unfiltered binary current-state traversal and exact marker continuation;
- terminal Loan zero-omission handling;
- resumable long-running bootstrap runner;
- deterministic compressed shards and digests;
- storage adapter and manifest verification contract;
- D1 snapshot metadata and active-pointer contract;
- controlled live interruption and resume evidence.

M1 still requires approved isolated preview access, complete fixed-ledger traversal, manifest verification, activation, rollback, cleanup, and resource evidence.

### M2 — Event history and lifecycle complete

Merged in dependency order:

1. incremental validated-ledger foundation, PR #10;
2. AffectedNodes normalization, PR #12;
3. Loan lifecycle engine, PR #13;
4. deleted-object archive, PR #14;
5. cover, debt, and loss tracking, PR #15;
6. status engine and reconciliation, PR #16;
7. Checkpoint B history boundary, PR #17.

Public completeness claims remain bounded by Checkpoint B and later M6 evidence.

### M3 — Public API complete

Merged in dependency order:

1. core entity API shell, PR #18, squash merge `86258cadc4c44891708de89db2d7c55868161dfd`;
2. activity, search, and history API, PR #19, squash merge `c74753f1041efd6554052d90796eb3d5485ea5b9`;
3. bounded activity exports and feeds, PR #20, squash merge `d0a8ef2e0b32345ed45284f37125fee714725a02`.

The API remains read-only and Devnet-only. Current entity collections remain explicitly unavailable until active-snapshot and object-shard reading are complete.

### M4-0 — UI specification and route architecture complete

PR #21 established:

- dark ledger-observatory visual system;
- Monitor, Audit, System, and Project information groups;
- canonical page map and route ownership;
- page responsibilities and API dependencies;
- reusable component and data-state contracts;
- responsive and accessibility behavior;
- mockup interpretation and prohibition on invented mock data;
- required About, Methodology, Contact, and API pages;
- optional disabled-by-default Support at `/about#support`;
- recalibrated M4, M5, and M6 roadmap;
- Codex UI execution boundary and repository operating rules.

## M4-1 implementation

### Application shell

Implemented:

- dark navy to near-black design tokens;
- persistent desktop sidebar;
- Monitor, Audit, System, and Project groups;
- only implemented routes are interactive; future routes are marked `Planned`;
- mobile app bar, bottom navigation, and More menu;
- persistent DEVNET, epoch, validated-ledger, data-age, and collector context;
- skip link, semantic landmarks, visible focus, reduced motion, long-identifier handling, and mobile safe-area support;
- read-only footer and repository/status links.

### Data loading

Implemented independent resource loading for:

- `/api/status`;
- `/api/overview`;
- `/api/activity?limit=6`.

A failed resource does not remove successful sibling panels. Requests abort on unmount. Retry is user initiated. Public-safe HTTP failures are shown explicitly.

### Overview

Implemented:

- Vault, Loan Broker, Loan, current-object, and active-snapshot metrics;
- no substitution of unavailable counts with zero;
- Direct and Unavailable provenance treatment;
- collector and server health;
- amendment enabled and supported facts shown separately;
- active-snapshot unavailable explanation;
- bounded Indexed activity table;
- partial-failure warning;
- Devnet reset and epoch preservation notice;
- Direct, Derived, Indexed, and Unavailable legend;
- no USD conversion, oracle pricing, cross-asset totals, unsupported charts, peer count, uptime, or fabricated values.

### Network Status

Implemented:

- server endpoint, version, state, complete-ledger range, validated ledger, hash, and age;
- collector status, committed cursor, attempt/success times, data age, failures, hash, reset reason, and public error;
- current epoch identity and boundary;
- amendment enabled and supported matrix;
- stale, unavailable, loading, and error behavior;
- explicit interpretation boundary against Mainnet readiness, safety, availability guarantees, or investment claims.

### Routing

M4-1 uses the platform History API for:

- `/`;
- `/network-status`.

Unknown routes render a dedicated not-found state. No routing dependency was added. The decision may be revisited in a focused later route unit if route count, deep-link behavior, static fallback, or accessibility evidence requires it.

### Responsive behavior

Implemented:

- desktop persistent sidebar;
- compact tablet/mobile context;
- mobile app bar, bottom navigation, and More menu;
- intentional metric, status, definition, and panel reflow;
- dedicated overflow only for the activity table;
- visual identifier truncation without changing full link targets.

## M4-1 validation

### Focused unit coverage

`src/ui/lib/formatting.test.ts` contains six passing tests covering:

- explicit Unavailable handling;
- integer and duration formatting;
- UTC timestamp validation;
- long-identifier visual truncation;
- semantic status tones;
- nullable boolean and machine-label formatting.

### Browser coverage

`tests/e2e/smoke.spec.ts` contains four passing Chromium tests covering:

- desktop observatory Overview;
- sidebar and persistent context;
- API-supported metrics and recent activity;
- client-side navigation to Network Status;
- snapshot unavailability without mock counts;
- partial activity failure while successful panels remain;
- mobile app bar, bottom navigation, More menu, and network context;
- absence of USD output.

### CI evidence

PR #22 CI run `28567044276`, job `quality`, passed:

- dependency installation;
- lint;
- TypeScript type-check;
- full unit test suite;
- local D1 migrations;
- production build;
- Chromium installation;
- all browser smoke tests.

The first CI run identified a Playwright locator ambiguity because the validated ledger correctly appeared in both the persistent context and health panel. The test was corrected by scoping the assertion to the network-context region; product behavior was not weakened.

No collector, API, migration, Cloudflare, deployment, Mainnet, wallet, signing, or write behavior changed in M4-1.

## Known open questions

| Question | Required evidence | Assigned point |
|---|---|---|
| What retention window applies to failed bootstrap prefixes? | Preview cleanup, storage, rollback, and runtime measurements | M1 closeout |
| What is the confirmed successful overpayment transaction shape? | Isolated fixture and validated metadata | M6 fixture review |
| How should each deletion reason be classified? | Transaction and DeletedNode fixtures | M5-2 / M6 |
| Which MPT metadata fields remain consistently available? | Live issuance fixtures | Asset enrichment follow-up |
| Does M4 need a routing dependency beyond the History API? | Route count, deep-link, static fallback, bundle, and accessibility evidence | M4-5 or earlier if blocked |
| What are the final Google Form and GitHub Issue URLs? | Explicit configuration approval | M4-6 / Checkpoint D |
| Will Support be enabled for initial release? | Address, network, asset, destination-tag, QR, disclosure, and owner approval | M4-6 / Checkpoint D |

## Active decisions and prohibitions

- current objects are tied to one validated ledger and epoch;
- partial bootstrap data is never published as complete current state;
- M4 uses the approved dark ledger-observatory direction;
- generated mockups define layout direction only;
- missing data is not zero;
- on-ledger and schedule states remain separate;
- assets remain separate;
- USD conversion, oracle/DEX pricing, cross-asset totals, unsupported operational metrics, and proprietary risk scores remain prohibited;
- About, Methodology, Contact, and API are required baseline pages;
- Support remains optional and disabled by default at `/about#support`;
- production deployment, remote infrastructure changes, wallet/signing, write operations, and Mainnet remain unapproved.

## Current blockers

No known code blocker remains for M4-1.

A real isolated preview bootstrap still depends on approved external preview access. That does not block UI work against explicit unavailable states.

Contact URLs and Support configuration remain unapproved; no placeholder values may be published.

## Continuation documents

- `docs/codex-goal.md` — durable project objective;
- `docs/codex-master-task.md` — end-to-end execution task;
- `docs/codex-ui-task.md` — M4/M5 UI execution rules;
- root `AGENTS.md` — mandatory operating rules and approval gates.

## Operational rule

Every implementation pull request updates this file with exact current work, validation, blockers, and the first incomplete action. Coherent work must be committed and pushed before interruption so later work does not depend on conversation history.
