# R3 adapter and reader integration plan — 2026-08-01

Status: **complete and retained as R3 evidence**. R3A–R3E and the parent R3 exit are merged on `main` through PR #1101, merge `78e221e17d41c2a8bc55d2b6898d4fc088cdb9d2`.

R3 remained local and provider-neutral. It selected no hosted provider and performed no remote deployment, production mutation, public-reader switch, Queue or Cron change, Mainnet change, recovery, qualification, or soak work.

## Delivered architecture

```text
portable phase runtime
  -> StorageAdapter
  -> SchedulerAdapter
  -> ExecutionAdapter

committed portable state
  -> committed read fence
  -> generic committed reader
  -> strict seven-class mappers
  -> legacy-authoritative shadow comparison

committed work
  -> immutable publication candidate
  -> independent verification
  -> publication watermark
  -> bounded maintenance

all portable durable state
  -> canonical complete-state export
  -> one-transaction empty-target restore
  -> exact parity and continuation
```

SQLite remains the reference implementation. Existing public release-snapshot, base-plus-overlay, D1 history, and Git-backed history paths remain legacy-authoritative.

## Completed units

### R3A — Adapter interfaces and SQLite conformance

Complete in PR #1097, merge `741f4ac24396dd21ae100b963ea439782b1696be`.

Delivered provider-neutral storage, scheduler, execution, finalize-execution, publication, maintenance, and complete-state boundaries; SQLite wrappers; interface-driven phase execution; unchanged R2 atomicity; and provider-import guards.

### R3B — Committed generic reader

Complete in PR #1098, merge `fa04ea280525e7c93bf13dd1b8debbfcf78193af`.

Delivered immutable read fences, exact/semantic/range/relationship reads, deterministic ordering and pagination, source/query/order/fence-bound SHA-256 cursors, staged-row exclusion, and strict committed-row integrity.

### R3C — Product mappers and shadow compatibility

Complete in PR #1099, merge `e7bcedcf3f597e765da42098a89683e1ba62cd68`.

Delivered strict mappers for all seven semantic classes, complete provenance, explicit tombstone behavior, `legacy_only` and `shadow_compare`, deterministic bounded comparison evidence, and unchanged legacy authority.

Portable-primary and portable-only modes remain unimplemented.

### R3D — Publication and maintenance separation

Complete in PR #1100, merge `25d35741a1e0b60d01ba422e5ab8fba3edf15a3e`.

Delivered migration `10007`, committed-only contiguous publication selection, canonical immutable assets and manifests, independent reopen and digest verification, verified-only publication-watermark advancement, collection-watermark independence, chained publication, bounded replay-safe chunk compaction, retained committed rows and watermarks, and tamper rejection.

### R3E — Complete-state transfer and parent exit

Complete in PR #1101, merge `78e221e17d41c2a8bc55d2b6898d4fc088cdb9d2`.

The outer complete-state schema version 1 preserves inner runtime schema version 3 and transfers:

- collection work, payload chunks, commit chunks, reference rows, and committed watermarks;
- scheduler messages and outbox entries;
- publication candidates and ordered work membership;
- publication watermarks;
- maintenance plans and mutations.

Restore requires a fully empty compatible target, restores inside one transaction, re-exports the target, and commits only after exact canonical byte parity.

The parent suite proves staged, committing, committed, published, and maintained transfer; committed-reader fence parity; same-source cursor continuation and cross-source rejection; scheduler message/outbox parity; publication and maintenance continuation; non-empty target rejection; unsupported schema rejection; and invalid publication-chain rollback to empty.

## Source isolation and public authority

- one response uses one source and one read fence;
- one cursor is valid for one source, query, order, and fence;
- portable and legacy rows are never mixed inside one response;
- integrity failure never triggers silent fallback;
- public authority remains legacy;
- R3 changed no public route.

## Parent R3 exit evidence

Final documentation CI run `30702737272` passed:

- workflow-surface guard;
- lint;
- shell syntax and canonical-base checks;
- TypeScript type-check;
- production runner bundle and configuration validation;
- complete unit-test suite;
- clean migrations through `10007`;
- application build;
- browser smoke.

## Successor phase

R4 is controlled by [`r4-deployment-profile-qualification-plan-2026-08-01.md`](r4-deployment-profile-qualification-plan-2026-08-01.md).

R4 evaluates deployment profiles locally and read-only. It rejects mandatory payment/card requirements and automatic overage, tests transaction and scheduler semantics, proves exact complete-state transfer, measures throughput and resource headroom, and selects no profile until every hard gate passes.
