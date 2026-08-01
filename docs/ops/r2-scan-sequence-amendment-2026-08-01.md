# R2 repeated scan wake-up identity amendment — 2026-08-01

Status: controlling amendment to the scan-message identity sections of `r2-portable-runtime-contract-2026-08-01.md` and `r2b2-bounded-phase-runtime-plan-2026-08-01.md`.

This amendment is local and provider-neutral. It authorizes no remote deployment, production mutation, provider selection, Mainnet change, recovery, or soak work.

## Problem

A caught-up scan must reserve another future scan from the same committed ledger/hash boundary. The current scan identity contains only network, epoch, base identity, previous ledger index, and previous ledger hash.

The durable scheduler treats one message ID as one immutable message and one immutable `available_at`. Reusing that ID for a later caught-up wake-up would either:

- collide with the already completed message; or
- attempt to associate one semantic ID with a different availability time.

Both outcomes violate deterministic scheduler identity. Delivery-attempt metadata cannot solve this because retries must preserve the exact same phase cursor and message ID.

## Scan message amendment

`ScanPhaseMessageV1` adds one non-negative integer:

```ts
interface ScanPhaseMessageV1 {
  schemaVersion: 1
  phase: 'scan'
  messageId: string
  network: string
  epochId: string
  baseIdentity: string
  expectedPreviousLedgerIndex: number
  expectedPreviousLedgerHash: string
  scanSequence: number
}
```

Canonical identity becomes:

```text
scan:v1:<network>:<epoch>:<base>:<previous-ledger>:<previous-hash>:<scan-sequence>
```

`scanSequence` is semantic wake-up identity. It is not a delivery-attempt count.

## Sequence rules

1. The first scan from an immutable-base boundary uses `scanSequence = 0`.
2. The first scan after a committed watermark advances uses `scanSequence = 0`.
3. A caught-up scan that reserves another scan from the exact same boundary uses the current `scanSequence + 1`.
4. Retryable transport or storage failure preserves the exact same `scanSequence`, payload, and message ID.
5. Lease reclaim preserves the exact same `scanSequence`, payload, and message ID.
6. Duplicate delivery preserves the exact same `scanSequence` and converges on the retained result and successor.
7. Finalization that advances the boundary resets the next scan sequence to `0`.
8. A negative, missing, fractional, or unsafe `scanSequence` is an invalid message and causes no work mutation.
9. The runtime never infers a new sequence from wall-clock time, delivery count, or scheduler attempt count.

## Caught-up successor

For a caught-up result at boundary `(network, epoch, base, ledger, hash, sequence)`:

- current message completes with a caught-up result;
- successor uses the same network, epoch, base, ledger, and hash;
- successor uses `scanSequence = sequence + 1`;
- successor availability is selected by the scheduler policy;
- result, successor payload, successor ID, and successor availability are reserved atomically in the outbox.

## Retry distinction

A retry does not represent a new logical wake-up. Therefore:

```text
retry: same boundary + same sequence + same message ID
caught-up successor: same boundary + sequence + 1 + new message ID
cursor advance: new boundary + sequence 0 + new message ID
```

## Required tests

Before R2b2-B is complete, local and CI tests must prove:

- deterministic scan ID includes `scanSequence`;
- sequence `0` remains canonical for initial and post-finalize scans;
- two caught-up polls at the same boundary have distinct successive IDs;
- retry and stale-lease reclaim preserve one ID and sequence;
- changed sequence changes only the intended semantic identity component;
- missing, negative, fractional, and unknown sequence fields are rejected;
- canonical encode/parse and complete runtime export/restore retain sequence exactly;
- no existing commit or finalize identity changes;
- the complete repository CI suite remains green.

This amendment supersedes the earlier scan-message interface and scan identity text where they omit `scanSequence`. All other R2 and R2b2 invariants remain unchanged.
