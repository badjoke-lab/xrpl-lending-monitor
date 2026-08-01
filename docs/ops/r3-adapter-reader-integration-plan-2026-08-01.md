# R3 adapter and reader integration plan — 2026-08-01

Status: controlling R3 contract. R2 and R3A–R3D are complete on `main`. R3E implementation and parent-exit validation passed in PR #1101 and are pending merge.

R3 is local and provider-neutral. It authorizes no hosted provider selection, remote deployment, production mutation, public-reader switch, Queue or Cron change, Mainnet change, recovery, qualification, or soak work.

## Objective

R3 converts the proven portable runtime into explicit adapter, committed-reader, product-mapper, publication, maintenance, and complete-state-transfer contracts without weakening R2 invariants.

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

## Completed contracts

### R3A — Adapter interfaces and SQLite conformance

Complete in PR #1097, merge `741f4ac24396dd21ae100b963ea439782b1696be`.

Delivered provider-neutral storage, scheduler, execution, finalize-execution, publication, and maintenance interfaces; SQLite wrappers; interface-driven phase execution; unchanged R2 atomicity; and provider-import guards.

### R3B — Committed generic reader

Complete in PR #1098, merge `fa04ea280525e7c93bf13dd1b8debbfcf78193af`.

Delivered:

- immutable read fences containing network, epoch, base, ledger index/hash, and committed work ID;
- exact, semantic, ledger-range, and relationship reads;
- deterministic ordering and pagination;
- source/query/order/fence-bound SHA-256 cursors;
- staged-row exclusion and strict committed-row integrity.

### R3C — Product mappers and shadow compatibility

Complete in PR #1099, merge `e7bcedcf3f597e765da42098a89683e1ba62cd68`.

Delivered strict mappers for all seven semantic classes, complete provenance, explicit tombstone behavior, `legacy_only` and `shadow_compare` modes, deterministic bounded comparison evidence, and unchanged legacy authority.

Portable-primary and portable-only modes remain unimplemented.

### R3D — Publication and maintenance separation

Complete in PR #1100, merge `25d35741a1e0b60d01ba422e5ab8fba3edf15a3e`.

Delivered:

- migration `10007`;
- committed-only contiguous publication selection;
- canonical immutable assets and manifests;
- independent reopen and digest verification;
- verified-only publication-watermark advancement;
- collection-watermark independence;
- chained publication;
- bounded replay-safe payload and commit chunk compaction;
- retention of work, committed rows, and watermarks;
- tamper and changed-identity rejection.

## R3E — Complete-state transfer and parent exit

Status: **implementation and validation passed in PR #1101; merge pending**.

### Complete-state envelope

The outer schema is version 1 and preserves the existing inner runtime schema version 3 unchanged.

It contains:

- collection work, payload chunks, commit chunks, reference rows, and committed watermarks;
- scheduler messages and outbox entries;
- publication candidates and ordered work membership;
- publication watermarks;
- maintenance plans and ordered mutations.

All tables are exported in deterministic order through canonical JSON.

### Restore contract

Restore is permitted only into a fully empty compatible target.

It:

1. validates exact outer fields and schema version;
2. validates inner runtime schema version 3;
3. restores collection and scheduler state in dependency order;
4. restores publication candidates parent-first;
5. rejects missing parents and cycles;
6. restores publication and maintenance state;
7. re-exports the target;
8. requires exact canonical byte parity;
9. commits the one transaction only after parity succeeds.

Any failure returns the target to its prior empty state.

### Parent suite evidence

The parent R3E suite transfers staged, committing, committed, published, and maintained states together and proves:

- deterministic repeated export;
- exact target export parity after restore;
- committed-reader fence parity;
- same-source cursor continuation and cross-source rejection;
- completed scheduler message, dispatched outbox, and pending successor parity;
- verified publication and publication-watermark parity;
- applied maintenance-plan parity and zero-mutation replay;
- publication continuation for the next committed work;
- unchanged collection watermark during publication continuation;
- non-empty target rejection;
- unsupported schema rejection;
- invalid publication-chain rollback to empty.

Latest implementation head `0fbe87426d6f6e22d8cc1404abd5ed8653639967` passed CI run `30702565940`: workflow guard, lint, shell and base checks, type-check, production runner checks, complete unit suite, clean migrations through `10007`, build, and browser smoke.

## Source isolation and public authority

- one response uses one source and one read fence;
- cursors are valid for one source, query, order, and fence;
- portable and legacy rows are never mixed in one response;
- integrity failure never triggers silent fallback;
- public authority remains legacy;
- no public route is changed by R3.

## Parent R3 exit

R3 passes only after PR #1101 merges to `main` with the final documentation head passing ordinary CI.

The retained R3A–R3E evidence proves:

- R2 behavior through provider-neutral interfaces;
- committed-only reader semantics;
- all seven strict mappers;
- deterministic legacy-authoritative shadow evidence;
- independently verified publication;
- verified-publication-gated bounded maintenance;
- exact complete-state export, restore, and continuation;
- no hosted provider selection or production mutation.

## Next phase: R4

R4 begins only after the parent R3 exit merges. R4 evaluates deployment profiles locally and read-only against:

- mandatory paid dependency and automatic-overage rejection;
- transactional and committed-read conformance;
- scheduler lease, retry, duplicate, and successor semantics;
- exact export and restore;
- throughput and resource envelopes;
- fail-closed behavior before provider ceilings;
- automated deploy, rollback, checkpoint, and evidence paths without routine dashboard operation.

No profile is selected or deployed by R3.
