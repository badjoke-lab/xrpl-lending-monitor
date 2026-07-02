# Implementation status

Last updated: 2026-07-02.

## Current milestone

**M1 closeout — Current-state collector activation** and **M4-3 dependency — verified Loan Broker reads**.

M0, M2, M3, M4-0, M4-1, and M4-2 are complete. M1 still requires approved isolated preview storage, a complete verified bootstrap, activation, rollback, cleanup, and resource evidence.

## Canonical continuation point

Latest merged UI work:

- PR #24: `Add Vault list and detail UI`;
- squash merge: `189107d04ea94774b73d60e04a5635795a1f0f5c`;
- final CI passed lint, type-check, unit tests, local D1 migrations, build, existing browser tests, and three Vault browser tests.

Active dependency branch:

- branch: `api/current-state-loan-broker-reader`;
- base: `main` at `189107d04ea94774b73d60e04a5635795a1f0f5c`;
- scope: verified current Loan Broker collection and detail reads with bounded Vault relationship resolution and exact cover/debt derivations.

## Immediate work

1. open and validate the focused Loan Broker reader pull request;
2. fix failures without weakening digest checks, relationship integrity, asset identity, or read bounds;
3. merge only after all required checks pass;
4. implement M4-3 Loan Broker list and detail UI from updated `main`;
5. keep real storage binding and public deployment behind the existing approval gate.

The first incomplete action is opening and validating the Loan Broker reader pull request.

## Completed M4 baseline

### M4-1

The dark responsive application shell, Overview, Network Status, persistent Devnet context, shared unavailable/stale/partial/error states, and browser coverage are merged.

### M4-2

The verified Vault API and responsive Vault list/detail UI are merged. Vault quantities remain exact and asset-separated. Missing relationships remain explicitly unavailable rather than inferred.

## Active Loan Broker reader implementation

### Shared verified storage helpers

The current-state reader now exposes its existing verified manifest, verified shard, and object-index-range lookup helpers for reuse. Vault behavior remains unchanged.

The shared read path still verifies:

- active snapshot manifest metadata and SHA-256 content;
- snapshot, epoch, ledger, object prefix, counts, shard count, and compressed bytes;
- shard prefix, size, metadata digest, recomputed digest, gzip payload, schema, page, and per-type counts.

### Broker collection

`GET /api/loan-brokers` supports:

- limit from 1 to 100;
- snapshot-bound opaque cursor;
- `id_asc` and `id_desc` ordering;
- bounded Broker-shard reads;
- factual text query across Broker ID, Vault ID, owner, and pseudo-account;
- direct object and relationship provenance;
- explicit unavailable state without an active snapshot or storage binding.

### Vault relationship and asset resolution

Each Loan Broker amount inherits its canonical asset identity from the referenced Vault in the same active snapshot.

The reader:

- locates each referenced Vault by manifest object-index range;
- groups duplicate Vault relationships by shard;
- reuses shards already read during Broker scanning;
- reads no more than eight additional relationship shards per request;
- fails closed if the relation is outside the active manifest or the Vault is absent from its verified shard.

This prevents unlabeled debt or cover quantities and avoids per-Broker repeated shard reads.

### Broker detail

`GET /api/loan-brokers/:brokerId` validates the 64-character hexadecimal ID, reads one candidate Broker shard, resolves the related Vault through at most one additional shard, and returns raw Broker data only after normalized fields.

### Exact derived values

The serializer exposes:

- `debt_utilization_bps = floor(DebtTotal / DebtMaximum * 10000)`;
- `required_minimum_cover = DebtTotal * CoverRateMinimum / 100000`;
- `cover_surplus = CoverAvailable - required_minimum_cover`;
- `cover_ratio_bps = floor(CoverAvailable / required_minimum_cover * 10000)` when the denominator is positive.

All calculations use exact decimal coefficients. Invalid denominators or malformed quantities return unavailable derived values rather than fabricated numbers.

### Fail-closed behavior

- invalid input or cursor returns 400;
- missing snapshot or binding returns an explicit unavailable response;
- manifest, shard, or relationship integrity failure returns 503 with a public-safe message;
- relationship-shard cap excess returns 503;
- missing Broker returns 404;
- no Mainnet, wallet, signing, transaction submission, public write, remote resource, or deployment behavior is introduced.

## Tests added

Reader tests cover:

- Broker cursor pagination;
- related Vault asset identity;
- reuse of already-read Vault shards;
- direct detail lookup;
- relationship-shard cap rejection.

Serializer tests cover exact XRP debt utilization, required cover, cover surplus, cover ratio, related Vault identity, and provenance.

Final CI evidence is pending.

## Known open questions

| Question | Evidence | Point |
|---|---|---|
| Failed bootstrap prefix retention | Preview cleanup and rollback measurements | M1 closeout |
| Manifest cache policy | Preview latency and request evidence | M6 |
| Broker and relationship shard-cap tuning | Real preview density and response measurements | M1 preview / M6 |
| Loan counts by Broker | Verified Loan reader and bounded relationship index | M4-4 |
| Contact URLs | Explicit configuration approval | M4-6 |
| Initial Support enablement | Approved payment configuration and disclosures | M4-6 / Checkpoint D |

## Active prohibitions

- no unlabeled debt or cover quantity;
- no inferred or cross-snapshot relationship;
- no unavailable-data-to-zero substitution;
- no unverified or unbounded current-state read;
- no USD conversion, price feed, cross-asset total, or proprietary risk score;
- no remote infrastructure change, deployment, Mainnet, wallet, signing, transaction submission, or public write operation.

## Current blockers

No known code blocker prevents CI validation with local fake object storage.

Real public Broker data still requires an approved `CURRENT_STATE` binding and complete verified active snapshot.
