# Implementation status

Last updated: 2026-07-02.

## Current milestone

**M1 closeout — Current-state collector activation** and **M4-2 dependency — verified public Vault reads**.

M0, M2, M3, M4-0, and M4-1 are complete. M1 code foundations are complete, but a complete isolated preview bootstrap has not yet been stored, verified, and activated.

## Canonical continuation point

Latest merged UI work:

- PR #22: `Add observatory Overview and Network Status UI`;
- squash merge: `6c1703f14bd6a75fc6abb5872ebbedf9178260ec`;
- final CI passed lint, type-check, unit tests, local D1 migrations, build, and four Chromium tests.

Active branch:

- `api/current-state-vault-reader`;
- base: `main` at `6c1703f14bd6a75fc6abb5872ebbedf9178260ec`;
- purpose: provide a verified, bounded current-state Vault API before implementing the M4-2 Vault pages.

## Immediate work

1. validate the current-state reader and Vault route contract in CI;
2. fix failures without removing digest verification, snapshot scoping, or bounded reads;
3. merge only after required checks pass;
4. implement the Vault list and detail UI from updated `main`;
5. keep real preview storage binding and complete bootstrap activation behind the existing approval gate.

The first incomplete action is opening and validating the focused reader pull request.

## Completed milestones

### M1 foundations

Completed foundations include Devnet status and epoch handling, exact asset normalization, one-pass binary current-state traversal, exact marker continuation, resumable bootstrap, compressed shards, SHA-256 digests, manifest verification, D1 snapshot metadata, active-pointer activation, and controlled interruption/resume evidence.

Remaining M1 work requires approved isolated preview infrastructure, a complete fixed-ledger traversal, activation, rollback, cleanup, and resource measurements.

### M2 and M3

Incremental history, AffectedNodes normalization, lifecycle reconstruction, archives, cover/debt/loss history, reconciliation, core APIs, search, history, exports, and feeds are merged.

### M4-0 and M4-1

The approved dark ledger-observatory architecture is merged. The application shell, Overview, Network Status, responsive navigation, explicit unavailable/stale/partial/error states, and browser coverage are complete.

## Active reader implementation

### Snapshot and storage boundary

The active snapshot repository now exposes object prefix, manifest key and digest, shard count, compressed bytes, counts, and validated ledger identity.

`CURRENT_STATE` is an optional Worker `R2Bucket` binding. This branch does not create a bucket, change Wrangler configuration, migrate a remote database, or deploy anything. Without the binding, the API remains explicitly unavailable.

### Verification

The reader verifies:

- manifest metadata and recomputed SHA-256 digest;
- snapshot, epoch, ledger, object prefix, counts, shard count, and compressed bytes;
- shard prefix, stored byte count, metadata digest, recomputed digest, gzip payload, schema, snapshot ID, page number, and per-type counts.

Invalid or inconsistent data fails closed.

### Bounded Vault collection

`GET /api/vaults` supports:

- limits from 1 to 100;
- snapshot-bound opaque cursors;
- `id_asc` and `id_desc` order;
- a bounded number of shard reads per request;
- optional factual text query;
- optional `has_loss=true|false` filtering;
- direct provenance and read metrics;
- explicit unavailable state without an active snapshot or storage binding.

### Vault detail

`GET /api/vaults/:vaultId` validates a 64-character hexadecimal ID. It uses manifest `firstLedgerIndex` and `lastLedgerIndex` ranges to choose one candidate shard rather than scanning all shards.

### Derived fields

The serializer exposes exact calculations:

- `used_assets = AssetsTotal - AssetsAvailable`;
- `utilization_bps = floor(used_assets / AssetsTotal * 10000)`.

Invalid or non-positive totals return unavailable derived values.

## Tests added

Reader tests cover pagination, descending order, loss filtering, asset identity, range-based detail lookup, and digest mismatch rejection.

Route tests cover available Vault collection and detail, exact derivation, missing storage binding, limit validation, invalid IDs, and missing active snapshots.

Final CI evidence is pending.

## Known open questions

| Question | Evidence | Point |
|---|---|---|
| Failed bootstrap prefix retention | Preview cleanup and rollback measurements | M1 closeout |
| Manifest cache policy | Preview latency and request evidence | M6 |
| Per-request shard cap | Real shard-density evidence | M1 preview / M6 |
| Contact URLs | Explicit configuration approval | M4-6 |
| Initial Support enablement | Approved payment configuration and disclosures | M4-6 / Checkpoint D |

## Active prohibitions

- no mock values as facts;
- no missing-data-to-zero substitution;
- no unverified manifest or shard reads;
- no unbounded current-state scan in a public request;
- no USD conversion, pricing oracle, cross-asset total, or proprietary risk score;
- no production resource change, deployment, Mainnet, wallet, signing, transaction submission, or public write operation.

## Current blockers

No known code blocker prevents CI validation with fake storage.

Real public current-state data still requires an approved storage binding and a complete verified active snapshot.
