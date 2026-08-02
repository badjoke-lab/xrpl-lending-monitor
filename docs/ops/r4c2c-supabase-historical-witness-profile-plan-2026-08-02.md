# R4C2c isolated Supabase historical witness profile — 2026-08-02

Status: implementation proposed; exact main-branch remote proof pending.

## Purpose

The read-only discovery run `30741004656` froze three immutable Devnet ledgers containing `237` normalized records across all seven semantic classes. This unit persists that fixed witness set into a separate qualification profile and proves committed-only reader behavior without changing the active `supabase-devnet` stream.

## Fixed identity

- profile: `supabase-devnet-historical-witness`;
- network: `devnet`;
- epoch: `supabase-r4c2c-historical-witness-v1`;
- base identity: `historical-witness-2776760-2980845-3127240`;
- set ID: `r4c2c-devnet-historical-witness-v1`;
- work ID: `historical-witness-work-v1:2776760:2980845:3127240`;
- source discovery run: `30741004656`;
- fixed fence ledger: `3,127,240`;
- fixed fence hash: `6CDB77504546BE14D226CFFDFC61082EC73BF95191E5326536254903D87692B3`.

The source ledger set is exactly:

- `2,776,760` / `83CD41036ADD7F9D8FA247F04BF5156B6826D95C4E6A346B9A5499BE90C43A9D`;
- `2,980,845` / `5BA95992F3E649752BBA5550EEEF79DEB535881E10FF7C1D4F9EF953340B0C40`;
- `3,127,240` / `6CDB77504546BE14D226CFFDFC61082EC73BF95191E5326536254903D87692B3`.

## Isolation

The unit uses dedicated tables and RPCs:

- `xrpl_historical_witness_sets`;
- `xrpl_historical_witness_rows`;
- `xrpl_commit_historical_witness`;
- `xrpl_read_historical_witness_page`.

It does not insert into `xrpl_phase_streams`, mutate `xrpl_phase_watermarks`, alter the active phase epoch, or reuse the active committed-reader source identity. Non-contiguous historical ledgers therefore cannot advance or contaminate the active collector watermark.

## Atomic persistence contract

The commit RPC accepts one canonical JSON array and its SHA-256 digest. In one PostgreSQL transaction it must:

1. verify the exact set identity;
2. verify the encoded records digest;
3. require exactly `237` rows;
4. reject duplicate semantic-class/canonical-key identities;
5. require the fixed three ledger identities and hashes;
6. require canonical row order;
7. require sorted unique relationship IDs;
8. require the exact seven-class count envelope;
9. insert a `staging` set and all rows;
10. verify the inserted row count;
11. transition the set to `committed`.

Any exception rolls the whole transaction back. Repeating the exact same digest after commit returns `duplicate: true`; a conflicting repeat fails closed.

## Fixed class counts

- validated-ledger: `3`;
- protocol-event: `13`;
- object-change: `197`;
- loan-lifecycle: `3`;
- archived-object: `1`;
- balance-history: `2`;
- current-projection: `18`.

## Qualification-only Edge Functions

`xrpl-historical-witness` reconstructs the exact source ledgers from Devnet, runs the canonical parser and seven-class normalizer, verifies the fixed row envelope, and invokes the atomic commit RPC.

`xrpl-historical-witness-reader` exposes only the isolated set through:

- fence;
- exact;
- semantic;
- ledger-range;
- relationship reads.

Both functions require the same workflow-rotated, masked `XRPL_READER_VERIFY_TOKEN` and the exact purpose header. The token value must not be retained in artifacts, Issue comments, or repository files.

## Remote verification gate

The main-branch workflow must prove:

- exact loader and reader bundle identities;
- zero unresolved relative imports;
- zero Cloudflare runtime imports;
- first atomic commit success;
- duplicate commit convergence;
- fixed fence identity;
- full `237`-row pagination as `100 / 100 / 37`;
- unique deterministic rows;
- exact count parity for every semantic class;
- one exact lookup for every semantic class;
- non-empty relationship query spanning lifecycle, archived object, and current projection;
- digest-tamper rejection;
- query/order mismatch rejection;
- cross-source cursor rejection;
- stale-fence rejection;
- missing-token rejection;
- wrong-purpose rejection.

No part of this unit is credited before the exact main-branch bundle passes this verifier and sanitized evidence is retained.

## Prohibited effects

- active `supabase-devnet` stream mutation;
- active watermark mutation;
- public-reader switch;
- transaction submission;
- Mainnet enablement;
- profile selection;
- R5 recovery;
- stabilization or soak;
- paid resource use.

## Remaining after success

A successful run closes isolated non-empty persistence and reader parity for the seven-class witness set. It does not close complete-state export/restore, active-stream multi-chunk continuation, remote fault injection, throughput, resource qualification, or final profile selection.
