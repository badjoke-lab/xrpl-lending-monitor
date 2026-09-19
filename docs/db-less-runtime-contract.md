# DB-less runtime contract

Status: **authoritative**
Adopted: **2026-09-20**

## Decision

XRPL Lending Monitor will no longer use a hosted database or Cloudflare stateful runtime as its canonical data plane.

The target system separates three things:

1. a verified complete Current base at one fixed validated ledger;
2. bounded live deltas after that base;
3. append-only historical evidence derived from the same validated-ledger scan.

All three are published as content-addressed or manifest-verified static artifacts. The public application is static and reads those artifacts directly.

## Prohibited canonical dependencies

The production data plane MUST NOT depend on:

- Cloudflare D1;
- Cloudflare Queues;
- Cloudflare KV;
- Cloudflare R2;
- Cloudflare Durable Objects;
- Supabase or another hosted SQL database;
- a continuously running server process;
- a five-minute Git commit stream.

A future provider change is allowed only if it preserves the artifact and atomic-publication contracts and does not reintroduce a shared-account storage failure mode without a new explicit architecture decision.

## Current base

A Current base is a complete snapshot of all relevant `Vault`, `LoanBroker`, and `Loan` ledger objects from one fixed validated Devnet ledger.

Base generation MUST:

- pin one validated ledger index and hash;
- traverse `ledger_data` by type for `Vault`, `LoanBroker`, and `Loan`;
- reach marker exhaustion for all three types;
- decode with the supported XRPL binary codec;
- normalize into existing domain projections;
- reject duplicate object IDs;
- verify Broker -> Vault and Loan -> Broker relationships;
- emit deterministic shards and indexes;
- hash every artifact and manifest;
- activate only after full verification.

The successful 2026-09-11 fresh build at ledger 5,218,039 proves the basic full-snapshot path is feasible, but that snapshot is historical evidence, not an automatically current production base.

## Live Current

The live layer begins at `base.ledgerIndex + 1`.

Each collector run:

1. reads the active channel;
2. resolves the last committed ledger and hash;
3. reads the latest validated ledger;
4. scans a bounded contiguous range;
5. verifies every parent hash;
6. filters recognized Lending transactions;
7. derives Current projection mutations from AffectedNodes;
8. coalesces repeated mutations to the final mutation per object for that run;
9. emits a deterministic live-delta bundle;
10. uploads and verifies all bundle/index assets;
11. updates the active channel last.

A failed run does not advance the committed ledger.

The next run resumes from `lastCommittedLedger + 1`.

## Current read model

The public Current view is logically:

```text
verified base
+ ordered verified live deltas
= Current
```

Rules:

- later upserts override earlier/base objects;
- a deletion tombstone hides the object from Current;
- exact object lookup must not require loading the full base;
- list pages use prebuilt bounded indexes/pages, not a browser full scan;
- counts and summary metrics come from published summary/index artifacts;
- a browser must never download millions of objects to render a normal page.

Implementation may compact live deltas into new static overlay shards without changing the logical contract.

## History

The same validated-ledger scan produces:

- protocol events;
- normalized object field changes;
- Loan lifecycle events;
- archived deleted objects;
- balance/cover/loss history;
- transaction-to-object relationships.

History bundles are append-only within a generation. They carry start/end ledger indexes and hashes, record counts, schema version, and digests.

The existing canonical historical archive from ledger 3,371,676 through 3,932,301 is retained as a separate historical generation.

Coverage after 3,932,301 MUST NOT be implied. Any gap is displayed explicitly until independently backfilled and verified.

## Publication model

Initial publication target: GitHub Release assets.

Two classes of publication are used:

### Immutable generations

Used for:

- complete Current bases;
- historical archive segments;
- periodic compacted generations.

Generation assets never change after activation.

### Live channel

A small channel manifest identifies:

- schema version;
- network and epoch;
- active base generation;
- ordered live generation or overlay identity;
- last committed ledger index/hash;
- history coverage ranges;
- publication time;
- asset digests.

The channel is the only mutable public pointer. It is written last.

Readers must be able to keep using the previous valid channel if a new publication is incomplete or invalid.

## Static application

The React application is built as static assets.

It does not require a Worker API to render canonical data.

A UI data-source layer translates published artifacts into the existing UI response models. UI components should not know GitHub-specific URLs or asset layouts.

Target modules:

```text
src/ui/data/channel-source.ts
src/ui/data/current-source.ts
src/ui/data/history-source.ts
src/ui/data/artifact-client.ts
src/ui/data/current-overlay.ts
```

Exact names may change, but the abstraction boundary may not.

## Scheduling

The initial live cadence target is five minutes using GitHub Actions scheduled workflows.

Schedule delay is expected. Correctness depends on cursor/hash catch-up, not exact wall-clock execution.

No run assumes the previous scheduled run occurred.

## Compaction

An indefinitely growing list of five-minute delta files is not acceptable for browser reads.

Before cutover, implementation must prove a bounded compaction strategy. The preferred design is:

- five-minute immutable delta bundles;
- periodically compacted overlay/index shards;
- a channel that references only a bounded number of objects/assets needed for normal reads;
- periodic new Current bases when justified by measured cost.

Compaction must be deterministic and must not change historical semantics.

## Failure isolation

Current and History have separate availability states.

If live collection stops:

- the last verified Current remains available but becomes stale;
- historical data remains available to its last committed ledger;
- the UI displays age/lag explicitly;
- no unverified partial generation is exposed.

A failure in this project must not consume or disable a shared Cloudflare database quota because no Cloudflare stateful database is part of the runtime.

## Cutover rule

The legacy runtime is removed only after the DB-less path demonstrates:

- complete base generation;
- contiguous catch-up;
- interruption and replay;
- atomic publication;
- bounded browser reads;
- representative UI parity;
- at least one production-shaped soak.

No legacy collector is restarted merely to bridge the migration.
