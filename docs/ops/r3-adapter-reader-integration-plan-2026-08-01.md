# R3 adapter and reader integration plan — 2026-08-01

Status: controlling R3 contract. R2 is complete on `main` at merge `fb90cbbd3a44337dc0891552f3618581cfc31e1c`. R3A–R3C are complete on `main`; R3D implementation and validation passed in PR #1100 and is pending merge.

R3 is local and provider-neutral. It authorizes no hosted provider selection, remote deployment, production mutation, Queue or Cron change, Mainnet change, recovery, qualification, or soak work.

## Objective

Convert the proven SQLite reference runtime into explicit adapter, reader, mapper, publication, maintenance, and complete-state transfer contracts without weakening any R2 invariant or switching the public production reader prematurely.

```text
portable phase runtime
  -> StorageAdapter
  -> SchedulerAdapter
  -> ExecutionAdapter

committed portable state
  -> CommittedReader
  -> strict product mapper
  -> legacy-authoritative compatibility boundary

committed work
  -> PublicationAdapter
  -> immutable candidate
  -> independent verification
  -> publication watermark

verified published work
  -> bounded MaintenanceAdapter

all portable durable state
  -> canonical export
  -> empty-target restore
  -> parent R3 parity suite
```

SQLite remains the reference implementation. Existing release-snapshot, base-plus-overlay, D1 history, and Git-backed history readers remain legacy compatibility implementations until an explicit later cutover gate.

## Adapter contracts

### StorageAdapter

The storage adapter owns durable collector state:

- work creation and exact reads;
- payload chunk staging and exact ordered reads;
- complete candidate identity staging and committed-only reads;
- commit evidence;
- committed watermark reads;
- transaction-aware finalization;
- canonical runtime export and empty-target restore;
- bounded reconciliation candidates.

Requirements:

- no uncommitted candidate row is public;
- transaction ownership is explicit;
- idempotent writes compare complete identity;
- provider SQL and SDK types do not enter phase-runtime interfaces;
- storage errors are provider-neutral classifications.

### SchedulerAdapter

The scheduler adapter owns:

- deterministic versioned message enqueue;
- claim, lease, stale reclaim, and attempt count;
- retry at the same message ID;
- terminal failure with no successor;
- atomic completion and one timed successor outbox entry;
- duplicate completion and dispatch convergence;
- scheduler export and restore.

### ExecutionAdapter

The execution adapter supplies:

- network, epoch, base identity, and immutable boundary;
- validated head and exact contiguous estimates;
- normalized source candidates for the planned range;
- resource counters;
- deterministic successor and retry timing;
- retryable and terminal failure classifications.

It cannot advance a cursor, publish rows, or silently change a requested range.

### PublicationAdapter

The publication adapter is separate from the normal collection scheduler. It owns:

- committed-only work selection after a publication watermark;
- contiguous ledger and parent-hash verification;
- deterministic immutable candidate assets and manifests;
- candidate persistence without watermark movement;
- independent reopen and digest verification;
- publication-watermark advancement after verification only.

Publication failure cannot halt or advance collection. Collection success does not imply publication success.

### MaintenanceAdapter

Maintenance is separate from collection and publication. It may compact only records covered by:

1. a committed collection watermark;
2. an independently verified publication watermark;
3. an explicit retention rule;
4. a bounded replay-safe mutation plan.

Maintenance never advances collection or publication watermarks.

## Committed reader contract

### Read fence

Every portable read is bound to:

```ts
interface PortableReadFenceV1 {
  schemaVersion: 1
  network: string
  epochId: string
  baseIdentity: string
  ledgerIndex: number
  ledgerHash: string
  workId: string
}
```

One response cannot combine rows from different fences or sources.

### Generic committed reader

The reference reader provides:

- exact lookup by semantic class and canonical key;
- deterministic semantic listing;
- deterministic source-ledger range listing;
- relationship lookup;
- work and watermark provenance;
- source/query/order/fence-bound opaque cursors.

Unknown class, malformed identity, changed fence, changed query, changed source, and cursor tamper fail closed.

### Product mappers

Strict versioned mappers exist for:

- `validated-ledger`;
- `protocol-event`;
- `object-change`;
- `loan-lifecycle`;
- `archived-object`;
- `balance-history`;
- `current-projection`.

A mapper cannot invent missing transaction, object, relationship, ledger, hash, epoch, state, or tombstone values.

## Legacy compatibility states

R3 implements only:

1. `legacy_only`
   - legacy response remains authoritative;
   - portable reader is not invoked.
2. `shadow_compare`
   - legacy response remains authoritative;
   - a separately fenced bounded portable snapshot produces comparison evidence only;
   - portable rows are never mixed into the response.

Later modes `portable_primary_legacy_fallback` and `portable_only` remain unimplemented. Integrity, identity, digest, cursor, or partial-read failure can never trigger silent fallback.

## Source isolation

- one response page uses one source and one fence;
- one cursor is valid for one source, query, order, and fence;
- relationship expansion cannot mix sources;
- integrity failure is not availability failure;
- source change requires a new request and cursor.

## Conformance areas

### Storage and scheduler

- complete typed identity;
- no pre-finalize visibility;
- atomic finalization and rollback;
- exact retry and lease behavior;
- duplicate convergence;
- staged, committing, and committed resumption;
- export and restore parity.

### Reader and mapper

- committed-only rows;
- stable ordering and pagination;
- exact, range, and relationship queries;
- source/fence cursor rejection;
- seven product mappers;
- tombstone behavior;
- malformed value and identity rejection;
- source isolation.

### Publication and maintenance

- committed-only contiguous selection;
- deterministic candidate asset and manifest;
- independent reopen and digest verification;
- publication watermark after verification only;
- collection watermark independence;
- no maintenance before verified publication watermark;
- bounded replay-safe chunk compaction;
- retained work, committed rows, and watermarks.

### Complete-state transfer

- canonical collection and scheduler state;
- canonical publication and maintenance state;
- empty-target restore;
- exact committed-reader fence and query parity;
- publication and maintenance continuation after restore;
- staged, committing, committed, published, and maintained fixtures.

## Implementation sequence

### R3A — Adapter interfaces and SQLite conformance

Status: **complete** in PR #1097, merge `741f4ac24396dd21ae100b963ea439782b1696be`.

Delivered provider-neutral interfaces, SQLite wrappers, interface-driven phase execution, unchanged R2 atomicity, and provider-import guards.

### R3B — Committed generic reader

Status: **complete** in PR #1098, merge `fa04ea280525e7c93bf13dd1b8debbfcf78193af`.

Delivered immutable read fences, exact/range/relationship reads, deterministic ordering, SHA-256 cursor identity, and committed-row integrity validation.

### R3C — Product mappers and shadow compatibility

Status: **complete** in PR #1099, merge `e7bcedcf3f597e765da42098a89683e1ba62cd68`.

Delivered seven strict mappers, complete provenance, `legacy_only` and `shadow_compare`, deterministic evidence, and unchanged legacy authority.

### R3D — Publication and maintenance separation

Status: **implementation and validation passed in PR #1100; merge pending**.

Delivered:

- migration `10007`;
- committed-only contiguous publication selection;
- canonical asset and manifest identities;
- candidate persistence before watermark movement;
- independent verification;
- verified-only publication-watermark advancement;
- publication chaining;
- collection-watermark independence;
- bounded old payload/commit chunk compaction;
- maintenance replay convergence and tamper rejection.

Latest validated head `199497d73774fd739f37c65e4771b5a4ad9b460a` passed CI run `30701236573`: workflow guard, lint, shell checks, base-identity validation, type-check, runner checks, complete unit suite, clean migrations including `10007`, build, and browser smoke.

### R3E — Cross-adapter export, restore, and parent exit

Status: **next after PR #1100 merges**.

Required work:

- define the canonical complete-state envelope without replacing runtime version 3 collection identity;
- include collection store, scheduler, publication candidates, publication work membership, publication watermarks, maintenance plans, and maintenance mutations;
- restore only into an empty compatible target;
- verify exact canonical export parity after restore;
- prove committed-reader fence and query parity;
- prove source-bound cursor behavior against the restored fence;
- prove publication continuation and maintenance replay after restore;
- cover staged, committing, committed, published, and maintained states;
- pass the parent R3 conformance suite and ordinary CI.

## R3 exit

R3 passes only when:

- all adapter and maintenance contracts have reference implementations;
- R2 behavior passes unchanged through interfaces;
- committed reader and seven mappers pass conformance;
- legacy and portable sources remain isolated;
- shadow comparison is deterministic;
- publication and maintenance remain separate from collection;
- complete-state cross-adapter export and restore pass;
- no hosted provider is selected;
- no production path, Queue, Cron, Mainnet flag, recovery, qualification, or soak is changed;
- lint, type-check, complete unit suite, all migrations, build, and browser smoke pass.

R4 begins only after the parent R3 exit merges with retained evidence. R4 selects and qualifies deployment profiles; R3 does not.
