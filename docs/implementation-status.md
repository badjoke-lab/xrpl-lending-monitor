# Implementation status

Last updated: 2026-07-02.

## Current milestone

**M1 closeout — Current-state collector activation** and **M4-1 — App shell, Overview, and Network Status**.

M0, M2, and M3 are complete. M4-0 UI specification and route architecture merged through PR #21. M1 code foundations are complete, but M1 has not exited because a complete isolated preview bootstrap has not yet been stored, verified, and activated.

## Canonical continuation point

Latest merged source-of-truth change:

- PR #21: `Define UI architecture and recalibrate M4–M6 roadmap`;
- squash merge: `0deae49e730f22b866674007b5a0d8d0eec564c3`;
- CI: passed;
- result: M4 UI implementation may resume under the new UI source-of-truth documents.

Active M4-1 branch:

- branch: `ui/observatory-overview-status`;
- base: `main` at `0deae49e730f22b866674007b5a0d8d0eec564c3`;
- roadmap unit: M4-1 App shell, Overview, and Network Status;
- current state: implementation, focused unit test, and Playwright coverage added; pull request and CI validation are the next actions.

Preserved superseded checkpoint:

- branch: `ui/overview-status-shell`;
- commit: `aa623b9` (`wip: checkpoint M4 overview shell`);
- state: pushed and preserved for audit;
- disposition: the API-fetching idea was reviewed, but the light simplified shell is not merge-ready and is superseded by the current canonical M4-1 branch.

Always inspect current branch heads, open pull requests, and checks before resuming.

## Immediate work

Complete M4-1:

1. review the complete branch diff against the UI source of truth;
2. open the focused M4-1 pull request;
3. run CI, type-check, unit, migration, build, and Playwright validation;
4. fix failures without weakening data, accessibility, responsive, or unavailable-state rules;
5. record exact final evidence here and in the pull-request body;
6. merge only after required checks pass and explicit authorization remains valid;
7. continue to M4-2 Vault UI from updated `main`.

The first incomplete action is opening the M4-1 pull request and evaluating CI.

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
- one unfiltered binary current-state traversal;
- exact marker continuation;
- terminal Loan zero-omission handling;
- resumable long-running bootstrap runner;
- deterministic compressed shards and digests;
- object-storage adapter and manifest verification contract;
- D1 snapshot metadata and active-pointer contract;
- controlled live two-batch interruption and resume evidence.

M1 still requires approved isolated preview access, a complete fixed-ledger traversal, manifest verification, activation, rollback, cleanup, and resource evidence.

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
- desktop, tablet, mobile, zoom, and accessibility behavior;
- mockup interpretation and prohibition on invented mock data;
- required About, Methodology, Contact, and API pages;
- optional disabled-by-default Support at `/about#support`;
- recalibrated M4, M5, and M6 roadmap;
- Codex UI execution boundary and repository operating rules.

## Current M4-1 implementation

### Application shell

Added:

- dark navy to near-black design tokens;
- persistent desktop sidebar;
- Monitor, Audit, System, and Project navigation groups;
- only implemented routes are interactive; future routes are marked `Planned`;
- mobile app bar;
- mobile bottom navigation and More menu;
- persistent DEVNET, epoch, validated-ledger, data-age, and collector context;
- skip link, semantic landmarks, visible focus, reduced-motion behavior, and mobile safe-area handling;
- read-only footer and repository/status links.

### Data loading

Added independent resource loading for:

- `/api/status`;
- `/api/overview`;
- `/api/activity?limit=6`.

A failed resource no longer removes successful sibling panels. Requests abort on unmount. Retry is user initiated. Public-safe HTTP failures are shown explicitly.

### Overview

Added:

- Vault, Loan Broker, Loan, current-object, and active-snapshot metrics;
- no substitution of unavailable counts with zero;
- Direct and Unavailable provenance treatment;
- collector and server health;
- amendment enabled and supported facts shown separately;
- active-snapshot unavailable explanation;
- bounded indexed activity table;
- partial-failure warning;
- Devnet reset and epoch preservation notice;
- Direct, Derived, Indexed, and Unavailable legend;
- no USD conversion, oracle pricing, cross-asset totals, unsupported charts, peer count, uptime, or fabricated values.

### Network Status

Added:

- server endpoint, version, state, complete-ledger range, validated ledger, hash, and age;
- collector status, committed cursor, attempt/success times, data age, failures, hash, reset reason, and public error;
- current epoch identity and boundary;
- amendment enabled and supported matrix;
- stale, unavailable, loading, and error behavior;
- explicit interpretation boundary against Mainnet-readiness, safety, availability, or investment claims.

### Routing

M4-1 uses the platform History API for the two implemented UI routes:

- `/`;
- `/network-status`.

Unknown routes render a dedicated not-found state. This avoids a new router dependency before broader route behavior is needed. The decision may be revisited in a focused M4 route unit if evidence requires it.

### Responsive behavior

Added:

- persistent sidebar on desktop;
- compact network context on tablet and mobile;
- mobile app bar and bottom navigation;
- More menu for the complete information architecture;
- intentional metric, status, definition, table, and documentation reflow;
- dedicated horizontal overflow only for the activity table;
- long identifier truncation with full link targets.

## M4-1 tests added

### Unit

`src/ui/lib/formatting.test.ts` covers:

- explicit Unavailable handling;
- integer and duration formatting;
- UTC timestamp validation;
- long-identifier visual truncation;
- semantic status tones;
- nullable boolean and machine-label formatting.

### Playwright

`tests/e2e/smoke.spec.ts` now covers:

- desktop observatory Overview;
- sidebar and persistent network context;
- API-supported metrics and recent activity;
- navigation to Network Status;
- snapshot-unavailable behavior without mock counts;
- partial activity failure while successful panels remain;
- mobile app bar, bottom navigation, More menu, and network context;
- absence of USD output.

Final CI evidence is pending at the time of this status update.

## Validation history

Merged work through PR #20 passed the applicable lint, type-check, unit, local D1 migration, build, browser smoke, API contract, and bounded live-read workflows recorded in the relevant pull requests.

M4 WIP checkpoint `aa623b9` passed `pnpm typecheck` and `pnpm build`; it is not merge-ready and is not the canonical implementation branch.

M4-1 final evidence will be recorded after CI.

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

No known code blocker prevents M4-1 CI validation.

A real isolated preview bootstrap still depends on approved external preview access. That does not block UI work against explicit unavailable states.

Contact URLs and Support configuration remain unapproved; no placeholder values may be published.

## Continuation documents

- `docs/codex-goal.md` — durable project objective;
- `docs/codex-master-task.md` — end-to-end execution task;
- `docs/codex-ui-task.md` — M4/M5 UI execution rules;
- root `AGENTS.md` — mandatory operating rules and approval gates.

## Operational rule

Every implementation pull request updates this file with exact current work, validation, blockers, and the first incomplete action. Coherent work must be committed and pushed before interruption so later work does not depend on conversation history.
