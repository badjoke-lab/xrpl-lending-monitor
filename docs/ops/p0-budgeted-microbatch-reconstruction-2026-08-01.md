# P0 budgeted microbatch collector reconstruction — 2026-08-01

Status: controlling recovery design and implementation schedule. This document supersedes the fixed-ledger-count Queue recovery described by PRs #1069–#1078 and Issues #1072/#1079.

## Decision

The retired fixed-32-ledger Queue collector is not approved for recovery.

Production proved that:

- a five-minute fixed 32-ledger pass could not match observed Devnet arrival;
- a one-minute fixed 32-ledger pass could still exceed an invocation limit because persistence cost depends on ledger contents.

A fixed ledger count is not a resource budget. The replacement collector budgets actual operations, splits heavy work into durable phases, and remains portable across execution and storage profiles.

No hosted runtime, database, scheduler, queue, or operator console is selected before R4 qualification.

## Non-negotiable product invariants

The reconstruction retains:

- every validated ledger after the active immutable base, with no intentional gap;
- protocol events for every supported Lending transaction type;
- normalized object before/after changes;
- Loan lifecycle events;
- deleted-object final states and archive history;
- debt, cover, and loss history;
- current Vault, LoanBroker, and Loan projection changes;
- exact transaction, object, relationship, epoch, ledger, hash, and provenance identities;
- truthful stale, halted, partial, reset, and unavailable states;
- Devnet-only and Mainnet-disabled operation;
- read-only public behavior with no wallet, signing, or transaction submission.

The public freshness requirement remains five minutes. Internal phase continuation may run more frequently.

## Portable architecture

The core owns:

- adaptive contiguous scan planning;
- XRPL ledger and parent-hash validation;
- semantic normalization;
- deterministic payload construction;
- `scan -> commit ... -> finalize -> scan` phase transitions;
- atomic finalization and committed-only visibility;
- retry, lease, duplicate, interruption, and halt semantics;
- read fences, source-bound cursors, and strict product mapping;
- independently verified immutable publication;
- verified-publication-gated maintenance;
- canonical complete-state export and empty-target restore;
- provider-neutral resource accounting.

Provider-specific implementations remain behind storage, scheduler, execution, publication, maintenance, and complete-state-transfer boundaries.

SQLite is the reference storage implementation. The local durable scheduler is the reference scheduler implementation.

## Approved phase state machine

```text
scan
  -> commit
  -> commit (when another bounded chunk is required)
  -> finalize
  -> scan
```

### Scan

- verify the exact immutable-base or committed-watermark boundary;
- read the validated head;
- plan a content-budgeted contiguous range;
- derive all seven semantic classes;
- stage deterministic payload chunks;
- reserve the first commit successor atomically;
- expose no candidate row and advance no collection watermark.

### Commit

- verify exact work, payload, chunk, range, digest, and candidate identities;
- write within row-mutation and operation limits;
- complete one chunk idempotently;
- reserve the next commit or finalize successor atomically;
- expose no candidate row and advance no collection watermark.

### Finalize

- reconstruct and verify the complete payload and commit evidence;
- verify semantic counts, ledger range, hashes, network, epoch, base, and candidate identity;
- atomically commit work, expose rows, advance the collection watermark, complete the message, and reserve the next scan.

No candidate row is public before finalization.

## Reference guards

- scan candidate ceiling: 48 ledgers;
- commit row-mutation ceiling: 40 records;
- reference storage-operation ceiling: 40 operations;
- payload chunk ceiling: 512,000 encoded bytes;
- scheduler message ceiling: 16,000 encoded bytes;
- no cursor or watermark movement during partial work.

These are project reference guards, not claims about a provider limit.

## Scheduler contract

The scheduler provides:

- one serialized owner;
- deterministic versioned messages;
- bounded leases and stale reclaim;
- retry at the exact message identity;
- one durable timed successor outbox entry per successful phase;
- duplicate completion and dispatch convergence;
- terminal halt with no successor for integrity, reset, hash, digest, or resource failure.

GitHub Actions is not the normal collection scheduler. It remains available for CI, immutable publication, evidence, and bounded repair workflows.

## Read, publication, and maintenance boundaries

Portable reads use one source and one committed read fence containing network, epoch, base, ledger index/hash, and committed work ID.

- portable and legacy rows are never mixed in one response;
- cursors are bound to source, query, order, and fence;
- integrity failure never triggers silent fallback;
- public authority remains legacy until a later explicit cutover gate.

Publication:

- selects committed work only;
- verifies contiguous ledger and parent-hash identity;
- builds a canonical candidate and manifest;
- independently reopens and verifies the candidate;
- advances only the publication watermark after verification.

Maintenance:

- requires committed collection coverage;
- requires independently verified publication coverage;
- requires an explicit retention rule and bounded replay-safe plan;
- never advances collection or publication watermarks.

## Complete-state transfer

The complete-state envelope preserves:

- collection work, payload chunks, commit chunks, candidate rows, and collection watermarks;
- scheduler messages and outbox;
- publication candidates, ordered work membership, and publication watermarks;
- maintenance plans and mutations.

Restore is allowed only into an empty compatible target and commits only after an exact canonical re-export parity check succeeds.

## Resource and throughput gates

Observed Devnet advance was approximately 84 ledgers per five minutes, or 16.8 ledgers/minute.

A profile is not approved unless retained evidence proves:

- steady committed throughput above 21 ledgers/minute at p95 windows;
- catch-up committed throughput above 30 ledgers/minute;
- no content-heavy ledger permanently blocks progress;
- scheduler, runtime, storage, and network work remains inside project guards;
- hot storage remains below its stop threshold;
- request, query, write, CPU, memory, row-size, message-size, and hidden-partial-work failures remain zero;
- exact complete-state export and restore;
- no mandatory paid dependency, payment method, credit-card verification, or automatic paid overage;
- fail-closed behavior before every provider ceiling.

## Implementation schedule

### R0 — Contract and portability reset

Status: **complete** in PR #1081, merge `c077e7b16b8b08213bbadcc5e927bba0f9472f6c`.

### R1 — Reference schema and deterministic planner

Status: **complete** in PR #1082, merge `85f42e665a5e6f2f519cd372718b9c41c16b3f68`.

### R2 — Portable scan/commit/finalize runtime

Status: **complete** in PR #1095, merge `fb90cbbd3a44337dc0891552f3618581cfc31e1c`.

Delivered typed messages, durable scheduler, normalized payloads, transaction-aware SQLite storage, repeated-scan identity, bounded scan and commit, identity-complete finalize, runtime schema version 3, and the parent R2 orchestration exit.

### R3 — Adapter, reader, publication, and complete-state integration

Status: **complete** in PR #1101, final merge `78e221e17d41c2a8bc55d2b6898d4fc088cdb9d2`.

Delivered:

- provider-neutral adapter interfaces and SQLite wrappers;
- unchanged R2 behavior through interfaces;
- immutable committed read fences and deterministic queries;
- strict mappers for all seven semantic classes;
- legacy-authoritative shadow comparison;
- independently verified publication;
- publication-gated bounded maintenance;
- complete collection, scheduler, publication, and maintenance state transfer;
- one-transaction empty-target restore and continuation parity.

Final R3 CI run `30702737272` passed workflow guard, lint, shell and base checks, type-check, production runner checks, complete unit suite, clean migrations through `10007`, build, and browser smoke.

### R4 — Deployment-profile qualification

Status: **active under `ops/r4-deployment-profile-qualification-plan-2026-08-01.md`**.

#### R4A — Contract and initial matrix

Status: active on branch `agent/r4-deployment-profile-qualification-contract`.

Initial classifications:

- cardless self-hosted SQLite service: conditional candidate;
- Supabase Free Postgres plus pg_cron/Edge Functions: conditional candidate;
- Turso Free storage plus cardless self-hosted executor: conditional candidate;
- existing Cloudflare Workers/D1/Queues profile: blocked;
- GitHub Actions-only collector: rejected;
- Deno Deploy Free managed runtime: rejected.

No profile is selected.

#### R4B — Machine-readable evaluator

Implement exact profile descriptors, hard-gate evidence, canonical decision artifacts, and a prohibition on scoring failed or unresolved profiles.

#### R4C — Local profile harnesses

Run the same conformance against local SQLite service management, local Postgres, local libSQL/Turso-compatible targets, and a local Cloudflare resource model.

#### R4D — Read-only shadow measurement

Use isolated read-only evidence only after payment/card and automatic-overage gates pass. No production mutation.

#### R4E — Selection decision

Produce either:

- `qualified_profile_selected`; or
- `no_profile_qualified`.

Schedule pressure cannot promote a conditional candidate.

### R5 — Controlled recovery

Deploy only a qualified R4 profile. Prove one staged work item, rollback, restore, and a fixed two-hour catch-up qualification.

### R6 — Lag-zero and steady qualification

Reach lag zero, pass twelve consecutive five-minute freshness checkpoints, and remain inside the measured no-cost envelope.

### R7 — Formal operation evidence

Arm independent immutable audit retention, pass a fixed 24-hour evidence window, then pass seven days of continuous operation before reopening formal Devnet release qualification.

## Current production state

- the retired chain halted on `Too many subrequests`;
- recorded lag was 56,740 ledgers;
- no successor exists;
- Worker Cron is empty;
- no stabilization or 24-hour soak is active.

Production remains fail-closed until one profile passes R4 and an explicit R5 recovery is approved.
