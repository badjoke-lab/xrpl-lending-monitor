# R2b normalized payload and bounded phase runtime — 2026-08-01

Status: controlling R2b implementation contract. This document refines the merged R2 runtime contract after R2a established deterministic control messages, durable SQLite leases, retry and terminal classifications, timed successor outbox behavior, and complete runtime export/restore.

R2b remains local and provider-neutral. It performs no remote deployment, production mutation, provider selection, Mainnet change, recovery, or soak work.

## Purpose

R2b connects the R1 work schema and R2a scheduler into one executable local state machine:

```text
scan -> commit -> commit ... -> finalize -> next scan
```

The unit must prove every supported semantic class survives deterministic normalization, bounded chunking, interruption, retry, export/restore, commit, and finalization without becoming publicly visible early.

## Runtime ownership

`PortableCollectorScheduler.completeWithSuccessor` owns the atomic SQLite transaction that completes a phase and reserves its successor.

Storage operations called from that transaction must not open a nested transaction. R2b therefore separates standalone convenience methods from transaction-aware primitives:

- standalone methods may open a transaction for direct tests and tools;
- `...InTransaction` methods require an existing caller-owned transaction;
- scan staging, commit mutation, finalization, current-message completion, and successor reservation are committed or rolled back together at their defined phase boundary;
- no nested `BEGIN` is allowed in the scheduler-owned runtime path.

## Digest contract

All payload and chunk digests use:

```text
sha256:<lowercase hexadecimal SHA-256>
```

The digest input is the UTF-8 byte sequence of canonical portable JSON produced by the existing recursive key-sorting serializer.

Requirements:

- the digest algorithm and prefix are versioned contract data;
- object key insertion order must not affect a digest;
- semantically ordered arrays retain their order;
- unordered candidate collections are sorted by their canonical identity before serialization;
- no timestamps, lease owners, delivery attempts, or transport metadata enter semantic payload digests;
- tests use the real SHA-256 implementation, not a placeholder checksum.

## Normalized payload envelope

```ts
interface NormalizedCollectorPayloadV1 {
  schemaVersion: 1
  workId: string
  network: string
  epochId: string
  baseIdentity: string
  previousLedgerIndex: number
  expectedParentHash: string
  startLedgerIndex: number
  endLedgerIndex: number
  finalLedgerHash: string
  ledgers: NormalizedCandidateV1[]
  protocolEvents: NormalizedCandidateV1[]
  objectChanges: NormalizedCandidateV1[]
  loanLifecycleEvents: NormalizedCandidateV1[]
  archivedObjects: NormalizedCandidateV1[]
  balanceHistory: NormalizedCandidateV1[]
  currentProjectionMutations: NormalizedCandidateV1[]
  semanticCounts: SemanticCountsV1
  digest: string
}
```

Every candidate uses a common persistence envelope while retaining class-specific normalized value data:

```ts
interface NormalizedCandidateV1 {
  semanticClass:
    | 'validated-ledger'
    | 'protocol-event'
    | 'object-change'
    | 'loan-lifecycle'
    | 'archived-object'
    | 'balance-history'
    | 'current-projection'
  canonicalKey: string
  sourceLedgerIndex: number
  sourceLedgerHash: string
  sourceTransactionHash: string | null
  objectId: string | null
  relationshipIds: string[]
  isTombstone: boolean
  value: unknown
}
```

Requirements:

- `ledgers` contains one evidence candidate for every ledger in the selected range;
- ledger indexes are exactly contiguous and hashes follow the supplied parent chain;
- the first ledger parent hash equals `expectedParentHash`;
- `finalLedgerHash` equals the final ledger candidate hash;
- every supported semantic group is present even when its count is zero;
- each candidate has a non-empty deterministic canonical key;
- duplicate `(semanticClass, canonicalKey)` pairs inside one work item are rejected;
- source ledger identity must fall inside the work range;
- transaction and object identities are mandatory when applicable to the semantic class;
- relationship IDs are deduplicated and sorted;
- candidate arrays are sorted by source ledger index, semantic class, canonical key, and source transaction hash before digesting;
- `semanticCounts` is derived from the arrays and cannot be supplied independently;
- no class may be discarded to satisfy a chunk or row budget.

## Payload chunk contract

The sealed envelope is flattened into deterministic persistence records after its full digest is computed.

Each chunk contains:

```ts
interface NormalizedPayloadChunkV1 {
  schemaVersion: 1
  workId: string
  chunkIndex: number
  totalChunks: number
  payloadDigest: string
  records: NormalizedCandidateV1[]
  chunkDigest: string
}
```

Reference limits:

- at most 40 records per commit chunk;
- at most 512,000 UTF-8 bytes per encoded payload chunk;
- at least one chunk, including for a ledger-only payload;
- one record must fit by itself or scan halts with `resource_halt` before work sealing;
- chunk indexes are zero-based and contiguous;
- chunk boundaries are deterministic for the same normalized payload and limits;
- payload chunks and commit chunks use the same chunk index in the R2 reference runtime;
- the work item records exact expected payload and commit chunk counts;
- each staged chunk stores its own digest while the work item stores the complete envelope digest.

## Fixture execution adapter

R2b uses a deterministic local `FixtureExecutionAdapter`.

It supplies:

- fixed clock and validated-head identity;
- ordered ledger fixtures with index, hash, parent hash, transactions, and normalized semantic candidates;
- the per-ledger cost estimates consumed by the R1 planner;
- injected retryable transport and storage failures;
- injected reset, epoch mismatch, base mismatch, parent-hash mismatch, digest mismatch, and resource halt;
- interruption hooks before and after each durable phase boundary;
- request, byte, record, and elapsed-budget counters.

The runtime imports no XRPL, Cloudflare, database-provider, or queue-provider SDK. Live XRPL transport remains a deployment-profile concern after adapter conformance.

## Scan phase

A scan invocation:

1. claims one exact `scan` message;
2. verifies its expected previous ledger and hash against the committed watermark or explicit bootstrap boundary;
3. reads the fixture validated head;
4. obtains contiguous per-ledger estimates and runs the R1 planner;
5. fetches only the planned range;
6. validates ledger index and parent-hash continuity;
7. builds and validates the complete normalized payload envelope;
8. computes semantic counts and the full SHA-256 digest;
9. builds deterministic bounded chunks and precomputes every chunk digest;
10. calls `completeWithSuccessor` with one transaction callback that creates the work item, stages every payload chunk, stages no committed-visible row, seals exact scan evidence, and reserves `commit:0`;
11. leaves the committed watermark and committed-only view unchanged.

Caught-up scan behavior records a bounded result and reserves a deterministic future scan message from the same committed boundary. The reference test policy supplies its exact time; production cadence remains a deployment-profile concern.

A blocked single ledger records `resource_halt`, publishes no successor, and advances nothing.

## Commit phase

A commit invocation:

1. claims the exact `commit` message and chunk index;
2. loads and decodes the matching staged payload chunk;
3. verifies work identity, payload digest, chunk digest, index, total count, and deterministic record order;
4. verifies the chunk is the next unresolved commit unit or already completed;
5. maps every candidate to a work-scoped reference row without changing semantic identity;
6. enforces at most 40 row mutations and the configured operation budget;
7. calls `completeWithSuccessor` with one transaction callback that inserts candidate rows idempotently and completes the commit chunk;
8. reserves the next commit chunk or `finalize` deterministically.

An already completed chunk performs no candidate mutation and converges on the retained successor identity and time.

## Finalize phase

A finalize invocation:

1. claims the exact `finalize` message;
2. loads all sealed work and chunk evidence;
3. recomputes and verifies payload and chunk digests, semantic counts, range, parent boundary, final hash, network, epoch, and base identity;
4. verifies every expected commit chunk is complete;
5. calls `completeWithSuccessor` with one transaction callback that runs transaction-aware work finalization, marks the work committed, advances the watermark, and makes its rows visible;
6. reserves the next deterministic scan message from the new committed ledger and hash.

A duplicate finalize returns the retained result and successor without moving the watermark twice.

## Failure and interruption behavior

- retryable transport failure occurs before durable scan mutation and retries the same scan message;
- retryable storage failure rolls back the complete scheduler-owned transaction and retries the same phase cursor;
- interruption before phase completion leaves either no phase mutation or one durable lease that can be reclaimed after expiry;
- interruption after outbox reservation is atomic with phase completion, so both exist or neither exists;
- reset, epoch mismatch, base mismatch, parent-hash mismatch, digest mismatch, invalid message, and resource halt publish no successor;
- no failure may expose candidate rows, advance the watermark, skip a ledger, or change message semantic identity;
- exact failure classification and evidence remain exportable and restorable.

## Required R2b tests

R2b is not complete until the complete repository suite proves:

1. sparse multi-ledger scan -> one commit -> finalize -> next scan;
2. dense payload split across multiple deterministic chunks and commit messages;
3. all seven semantic groups survive normalize, digest, chunk, commit, finalize, export, and restore;
4. zero-count semantic groups remain explicit in counts;
5. duplicate candidate identity rejection;
6. discontinuous ledger index and parent-hash rejection;
7. one oversized candidate and one oversized ledger halt before work sealing;
8. interruption inside scan transaction rolls back work, chunks, completion, and outbox;
9. interruption inside commit transaction rolls back candidate rows, chunk completion, current completion, and outbox;
10. interruption inside finalize transaction leaves work uncommitted, rows hidden, watermark unchanged, current message leased, and no outbox;
11. duplicate scan, commit, finalize, and dispatch convergence;
12. completed commit mutation is never repeated;
13. retryable transport and storage failures preserve exact message ID;
14. stale lease recovery resumes the same phase cursor;
15. reset, epoch, base, parent hash, digest, and resource failures halt without a successor;
16. staged and committing runtime export/restore resumes deterministically;
17. committed runtime export/restore preserves visible rows and watermark exactly;
18. no nested SQLite transaction occurs in the scheduler-owned finalize path;
19. no hosted-provider SDK import exists in the R2 portable runtime;
20. lint, type-check, complete unit suite, complete migration sequence, build, and browser smoke pass.

## Exit

R2b passes only when the normalized payload, deterministic chunking, fixture execution adapter, and all three bounded phases pass the required tests and merge to `main` with retained evidence.

That merge completes R2 only if the parent R2 contract has no remaining unmet test or semantic requirement. R2 completion does not authorize R3 production mutation, provider selection, Mainnet, recovery, or soak work.
