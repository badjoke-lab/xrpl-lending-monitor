# Implementation status

Last updated: `2026-08-01`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The fixed-ledger-count Queue recovery is retired. Production evidence on Issue #1079 proved that a one-minute 32-ledger chain can still halt on a content-dependent Worker subrequest limit. The chain stopped with terminal lag `56,740`; no stabilization qualification or 24-hour soak is active.

The public read surface remains a production test surface backed by the last verified immutable base plus committed live data. Mainnet remains disabled.

## Controlling recovery design

The controlling design is [`ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md`](ops/p0-budgeted-microbatch-reconstruction-2026-08-01.md).

The replacement collector preserves every public and semantic requirement while replacing the failed all-in-one invocation with:

- adaptive scan work bounded by actual transaction, byte, CPU, wall-time, and external-request budgets;
- resumable D1 commit chunks bounded below the 50-query Free-plan invocation limit;
- one small atomic finalization step that alone advances the cursor and committed watermark;
- work-scoped current/history rows invisible until finalization;
- separate bounded maintenance and GitHub-backed immutable publication;
- Queue catch-up at 30-second successors and steady operation at 60-second successors, subject to measured daily Free-plan budgets;
- guarded GitHub Actions for migration, deployment, Queue control, rollback, evidence, and publication, with no owner dashboard or terminal step.

A fixed ledger count is no longer accepted as a safety boundary.

## Current production evidence

Controlling checkpoint: Issue #1079.

- network: `devnet`
- Mainnet enabled: `false`
- active Worker version at failure: `fb27bd55-e624-439d-add2-2ed41e903c34`
- Worker Cron: empty
- last completed slot: `2026-08-01T03:52:00Z`
- failed slot: `2026-08-01T03:53:00Z`
- failure: `Too many subrequests by single Worker invocation`
- last processed ledger: `4,051,454`
- latest observed ledger: `4,108,194`
- terminal lag: `56,740`
- successor chain: halted
- 24-hour soak: not started

Queue delivery being configured as resumed does not mean the collector is operating when no successor exists.

## Active implementation order

### R0 — Contract reset

Status: active in PR #1081.

- close obsolete PR #1080;
- rewrite architecture, collector, runtime, resource, roadmap, and status documents;
- freeze all old 32-ledger recovery and qualification paths;
- record exact no-functionality-reduction invariants.

### R1 — Work schema and deterministic planner

- add collector work, payload chunk, commit chunk, and committed-visibility schema;
- implement adaptive candidate planning;
- add dense/heavy-ledger fixtures;
- prove that partial work cannot advance the cursor or become visible.

### R2 — Scan, commit, and finalize state machine

- implement typed Queue work messages;
- stage normalized payloads without canonical writes during scan;
- commit bounded chunks idempotently;
- finalize atomically;
- preserve every semantic class and canonical identity.

### R3 — Overlay, maintenance, and immutable publication separation

- make current/history queries read committed work only;
- compact superseded hot rows safely;
- publish deterministic immutable segments and indexes through GitHub Actions;
- advance archive watermarks only after independent verification.

### R4 — Automated deployment and rollback

- add exact-SHA migration/deployment workflow;
- pause/purge/seed/resume Queue automatically;
- retain pre/post snapshots and Issue evidence;
- rollback and fail closed without user intervention.

### R5 — Controlled production recovery

- apply migration and deploy reconstructed runtime;
- verify one staged work item end to end;
- run a fixed two-hour catch-up qualification;
- continue only when throughput, continuity, semantic, Queue, Worker, D1, and storage gates pass.

### R6 — Lag zero and steady qualification

- reach lag zero automatically;
- transition from 30-second catch-up to 60-second steady mode;
- pass twelve consecutive five-minute freshness checkpoints;
- prove immutable/live/current agreement.

### R7 — Formal operation evidence

- arm independent immutable audit retention;
- pass a fixed 24-hour evidence window;
- pass seven days of continuous operation;
- only then reopen formal Devnet release qualification.

## Acceptance limits

The reconstructed runtime is not approved until production-shaped evidence proves:

- steady committed throughput greater than 21 ledgers/minute;
- catch-up committed throughput greater than 30 ledgers/minute;
- Queue operations below 9,000/day in catch-up and below 5,000/day in steady mode;
- D1 rows written below 80,000/day and rows read below 4,000,000/day;
- D1 physical size below the project stop threshold;
- zero subrequest, CPU, memory, query-count, row-size, and hidden-partial-work errors;
- no supported semantic record loss;
- no gap, hash discontinuity, or cursor advancement before full finalization.

## Remaining release gates

After R7:

1. complete the final semantic cross-audit against XRPL transactions and AffectedNodes;
2. complete real-data browser regression and representative production behavior smoke;
3. complete integrity, reset, backup, restore, replay, and rollback verification;
4. complete Explorer v1 if it remains a release requirement after roadmap reconciliation;
5. complete desktop/mobile visual, accessibility, performance, security, and cross-browser audits;
6. configure the final public host, canonical metadata, sitemap, Search Console, analytics, and feedback routes;
7. freeze operations runbooks, watchdogs, alerts, backup, and recovery procedures;
8. produce the final release record and owner sign-off.

## Operating restrictions

- Do not describe the collector as operating while the successor chain is absent.
- Do not restart the retired fixed-32-ledger runtime.
- Do not start stabilization or soak before R6.
- Do not enable Mainnet.
- Do not remove semantic history classes or public product capabilities.
- Do not skip a failed ledger or advance a cursor after partial persistence.
- Do not require the owner to use the Cloudflare dashboard or local terminal for recovery.
- Do not call a theoretical Free-plan projection an operating result.