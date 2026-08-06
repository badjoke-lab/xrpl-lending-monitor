# R4F G2C offline source-shaped shadow

Date: `2026-08-06`.
Issue: `#1261`.

## Status

G2C adds a deterministic offline shadow that exercises source-shaped XRPL responses, parent-hash continuity, portable normalization, all eight revision-4 byte boundaries, canonical accounting, and the candidate persistence request shape.

It issues no network or database request and commits no recovery mutation. G2 remains unresolved until G2D verifies persistence and readback.

## Inputs and outputs

Input fixture:

- `ops/r4f/revision4-offline-shadow-fixture.json`.

Builder:

- `src/shared/supabase-revision4-offline-shadow.ts`.

Artifact script:

- `scripts/build-r4f-revision4-offline-shadow.mjs`.

The fixture contains two contiguous validated Devnet-shaped ledger responses with no lending transactions. The builder parses them with the production parser and normalizes them with the production portable normalization path.

The artifact contains:

- canonical accounting JSON and digest;
- exact persistence RPC request body;
- rolling billable-egress upper bound;
- memory/transport upper bound;
- ledger, record, chunk, and payload counts;
- parent-hash and normalization checks;
- explicit no-network, no-database, no-recovery, reader, Mainnet, stabilization, and soak flags.

## Persistence request fixed point

The persistence RPC request contains the accounting JSON, while the accounting JSON records the persistence request byte count. The builder resolves this self-reference by repeatedly:

1. building accounting with the current request-byte and canonical-JSON-byte values;
2. serializing the exact writer RPC request;
3. measuring its UTF-8 bytes and the accounting JSON bytes;
4. rebuilding until both values are unchanged.

Failure to converge within 32 iterations fails closed.

## Safety

Tests replace `fetch` with a throwing function, prove no request is attempted, verify every G1 direction, require deterministic reruns, validate the writer-compatible request shape, and reject broken parent hashes, malformed responses, and invalid source identity.

The script writes files only. It contains no Supabase credential, management API, writer RPC invocation, deployment command, issue mutation, or R5 executor call.

## Remaining G2 work

G2D must apply the candidate migration in an isolated local database, insert this exact offline evidence through the writer RPC, read it back through the reader RPC, and prove JSON/digest, sequence, direction, totals, idempotency, conflict rejection, and export parity.

No provider-side deployment or R5 execution is authorized.
