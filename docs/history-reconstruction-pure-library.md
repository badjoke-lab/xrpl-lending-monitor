# Immutable-history reconstruction pure library

This implementation unit provides local, deterministic building blocks and fixture coverage for a future runner-loss-tolerant reconstruction of the declared Devnet immutable-history gap.

It fixes the reconstruction identity at ledgers `3,800,886..3,932,301`, partitions the interval into 263 deterministic segments of at most 500 ledgers, validates candidate-only evidence with `productionMutation: false`, discovers the largest verified contiguous checkpoint prefix, plans exact-index spill super-buckets with the existing 256-bucket hash contract, and validates production-compatible final-tree paths.

The library reuses the existing public artifact contracts without changing their schema versions:

- `HistorySegmentManifest` remains schema version 1 with all seven required file kinds;
- `HistoryExactIndexManifest` remains schema version 2;
- exact terms continue to use `sha256-first-u32-mod-bucket-count` over 256 buckets;
- final runtime paths remain `history/<epoch>/<segment>/...`, `history/publication.json`, `history/index/exact/...`, and root `history-channel.json`.

The bounded four-segment fixture includes all five semantic history classes, explicit empty arrays, a fixed fixture transaction/object witness, valid parent-hash continuity, and a deliberate discontinuity test. It does not use Devnet, production data, credentials, Git refs, Actions, Cloudflare, or D1.

## Operational blockers remain

This unit does **not** establish reconstruction readiness. Representative actual-interval measurements, visible GitHub protection evidence, fixture-only ref-isolation proof, reviewed workflow permissions, and explicit human authorization remain mandatory before any workflow activation or real reconstruction.

No module in this unit performs Git writes, network calls, reconstruction execution, candidate publication, history promotion, qualification, or soak.
