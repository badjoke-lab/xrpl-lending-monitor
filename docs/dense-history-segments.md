# Dense history segments

Status: proposed

## Problem

The 2048-budget live benchmark proved that the collector can process 40 ledgers per active run in the dense Devnet range. It also observed 1,161–1,660 estimated logical rows and 70–116 overlay mutations per run. Sustained row-by-row D1 catch-up cannot fit the Free daily write budget.

## Decision

Separate dense historical backfill from live D1 continuation.

1. A bounded runner scans a fixed contiguous validated-ledger range outside the public Worker request path.
2. It reuses the canonical transaction filter and derivation logic used by the incremental collector.
3. Historical evidence is serialized into deterministic immutable segment artifacts instead of inserted row-by-row into D1.
4. Every segment records exact start/end ledger identities, counts, schema version, source revision, file digests, and previous-segment linkage.
5. Segment publication requires deterministic replay and continuity verification.
6. A replacement current-state base may be published only after the covered segment chain is complete and independently verified.
7. D1 live continuation resumes from the ledger immediately after the replacement base and stores only the bounded recent delta.
8. Public history readers merge immutable segment history with later D1 live history using stable ordering, duplicate suppression, and explicit provenance.
9. No cursor jump is allowed across an interval that is not covered by a verified contiguous segment chain.

## Segment files

```text
history-segments/<epoch>/<segment-id>/
  manifest.json
  ledgers.ndjson.gz
  protocol-events.ndjson.gz
  object-changes.ndjson.gz
  loan-lifecycle.ndjson.gz
  archived-objects.ndjson.gz
  balance-history.ndjson.gz
  current-projection-mutations.ndjson.gz
```

Files may be deterministically sharded when size measurements require it.

## Required gates

A chain is complete only when:

- the first segment begins at the exact selected continuation boundary;
- every ledger is contiguous by index and parent hash;
- adjacent segments link by terminal hash and next parent hash;
- the terminal ledger identity is independently confirmed;
- replay produces identical digests;
- derived surfaces pass reconciliation;
- the replacement base is independently verified;
- guarded handover is replay-safe and fail-closed;
- D1 cursor and overlay watermark start from the exact replacement-base identity;
- merged history reads have no duplicate canonical records.

## Implementation order

1. Define segment schemas and deterministic serializers.
2. Reuse the validated-ledger scanner and derivation functions in a file-output runner.
3. Add fixed-range checkpoint and resume state.
4. Add segment-chain continuity verification.
5. Produce a small non-canonical rehearsal segment twice and require byte-identical output.
6. Add publication metadata without changing public API behavior.
7. Add bounded history readers for immutable segments plus D1 live rows.
8. Backfill the dense gap into verified segments.
9. Build and verify a replacement current-state base.
10. Execute guarded handover and resume live continuation.
11. Re-evaluate HYB-7 and M1 exit at the validated head.
