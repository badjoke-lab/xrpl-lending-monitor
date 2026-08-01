# R2b2 bounded phase runtime plan — 2026-08-01

Status: controlling R2b2 implementation plan. Every R2b2 implementation unit is complete on `main`. The parent R2 orchestration exit suite passed validation in PR #1095 and is pending merge.

Controlling amendments:

- [`r2-scan-sequence-amendment-2026-08-01.md`](r2-scan-sequence-amendment-2026-08-01.md)
- [`r2b2-candidate-identity-persistence-amendment-2026-08-01.md`](r2b2-candidate-identity-persistence-amendment-2026-08-01.md)

R2 remains local and provider-neutral. It performs no remote deployment, production mutation, provider selection, Mainnet change, recovery, or soak work.

## Implemented state machine

```text
scan -> commit -> commit ... -> finalize -> next scan
```

Each invocation executes one bounded durable phase. Candidate rows remain hidden until finalization commits.

### Scan

- claims one exact versioned scan message;
- verifies immutable-base or committed-watermark boundary and scan sequence;
- detects reset and reads exact cost estimates;
- runs the adaptive contiguous planner;
- builds all seven normalized semantic classes and deterministic chunks;
- stages work and payload chunks inside scheduler-owned completion;
- reserves `commit:0` atomically;
- advances no public visibility or watermark.

Caught-up scans reserve the same boundary with sequence `+1`. Retry and stale-lease recovery preserve the same message ID and sequence. A blocked single ledger halts with no successor.

### Commit

- claims the exact commit message;
- verifies work, chunk, encoding, byte and record counts, digests, source range, canonical order, and identity uniqueness;
- requires the first unresolved chunk;
- writes at most 40 complete candidate identities and records at most 40 operations;
- completes commit evidence and reserves the next commit or finalize atomically;
- advances no public visibility or watermark.

### Finalize

- claims the exact finalize message;
- reconstructs every contiguous payload chunk and all seven semantic classes;
- verifies full payload digest, semantic counts, commit evidence, range, network, epoch, base, parent hash, final hash, and every durable candidate field;
- calls `finalizeWorkInTransaction` inside scheduler-owned completion;
- atomically exposes candidate rows, advances the watermark, completes finalize, and reserves the next scan at sequence `0`.

Duplicate finalization repeats neither visibility nor cursor movement. Integrity failures halt with no successor. Retryable storage interruption rolls back work, visibility, watermark, message completion, and outbox together.

## Complete candidate identity

Migration `10006_portable_reference_identity.sql` and runtime export version 3 preserve:

- semantic class and canonical key;
- source ledger index and hash;
- source transaction hash;
- object ID;
- canonical sorted relationship IDs;
- tombstone state;
- canonical value JSON.

## Completed implementation units

- R2b2-A transaction-aware store: PR #1088, merge `56dfe67cf969ac29357e7d49970da8b4027eba27`.
- Repeated scan identity contract: PR #1089, merge `51238a35184f5b4815fa79c1144df92ebe8d77a4`.
- Scan-sequence implementation: PR #1090, merge `bcb812b9001ea0e47cd2571e2ed3209c450cf84f`.
- Fixture execution and scan runtime: PR #1091, merge `7d1f50fa621b650efe0aae14fa074a2aff1ed8f3`.
- Bounded commit runtime: PR #1092, merge `fb40f9400760b00b7d0dfb69cf4392f16e61ff08`.
- Candidate identity persistence correction: PR #1093, merge `9fb931f78b7ea605d52cee8292728d3d48eb868a`.
- Identity-complete finalize runtime: PR #1094, merge `d1a50ba5988da7222a32f69d1593712fc4bd7f12`.

## Parent R2 exit suite

Status: **implementation and validation passed in PR #1095; merge pending**.

The dedicated durable orchestration suite proves:

- sparse scan, commit, finalize, and next-scan chaining;
- dense multi-chunk chaining;
- all seven semantic classes end to end;
- no early visibility or cursor advance;
- staged, committing, and committed export/restore resumption;
- scan, commit, and finalize interruption rollback with exact-identity retry;
- fresh-lease rejection, stale reclaim, and duplicate convergence;
- idempotent outbox dispatch;
- reset, epoch, base, stale-boundary, parent-hash, and resource terminal halts with no successor;
- provider-neutral imports.

Retained phase-local suites additionally prove message schema and size rejection, payload and chunk tamper rejection, commit wrong-index and 41-record halts, finalize candidate/digest/semantic-count rejection, scheduler identity conflicts, and transaction-aware finalization without nested SQLite transactions.

Retained validation from CI run `30698568464` passed:

- workflow guard;
- lint;
- type-check;
- production runner checks;
- complete unit suite;
- clean migration sequence;
- application build;
- browser smoke.

R2 and R2b2 pass only after PR #1095 merges to `main` with this evidence retained.

## Next gate

R3 begins after the parent R2 exit merge. It adds adapter conformance, committed-only reader integration, legacy compatibility, maintenance/publication separation, and cross-adapter export/restore. R3 does not select a hosted provider or authorize production recovery.
