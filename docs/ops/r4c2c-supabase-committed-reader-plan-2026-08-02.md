# R4C2c Supabase committed reader implementation — 2026-08-02

Status: implementation candidate. Local repository validation and remote Supabase deployment evidence are required before any reader gate is credited.

## Objective

Implement the R3B committed-reader contract on the isolated Supabase Free Devnet qualification profile without changing the public application reader.

The unit covers:

- one immutable fence bound to source, network, epoch, base, committed ledger/hash, and work;
- exact committed lookup;
- semantic-class listing;
- source-ledger range listing;
- relationship listing;
- deterministic ascending and descending ordering;
- bounded pagination;
- SHA-256 cursor integrity;
- source, query, order, and fence binding;
- fail-closed stale, malformed, tampered, cross-source, and cross-query cursor rejection;
- committed-only row visibility;
- strict row, hash, canonical JSON, relationship, and tombstone validation.

## Architecture

```text
qualification request
  -> xrpl-committed-reader Edge Function
  -> service-role-only xrpl_read_committed_page RPC
  -> active supabase-r4c2c-v1 stream
  -> exact committed watermark/work fence
  -> committed reference rows at or behind that fence
```

The Edge Function is a qualification surface only. It is not linked from the application and is not a portable-primary or public-reader cutover.

## Transaction and visibility boundary

The SQL RPC reads the active stream, watermark, and watermark work inside one PostgreSQL transaction snapshot.

It rejects the read when:

- the profile is not `supabase-devnet`;
- the stream is not Devnet, `supabase-r4c2c-v1`, and active;
- the watermark is missing;
- the watermark does not exactly match a committed work;
- the expected cursor fence is partial;
- any expected cursor fence field differs from the current watermark.

Rows are eligible only when:

- their work belongs to the exact profile, network, epoch, and base;
- their work is committed with `committed_at` present;
- the work ends at or before the fence;
- the row ledger lies inside its work range;
- the row ledger is at or before the fence.

Staged, committing, finalizing, error, other-epoch, other-base, and ahead-of-fence rows are excluded by the SQL predicate rather than filtered after exposure.

## Cursor contract

Cursor envelope: `pcr1.<hex canonical JSON>.<sha256>`.

The canonical payload contains:

- `sourceId`;
- complete immutable fence;
- query kind and filters;
- order;
- offset.

The reader rejects:

- invalid envelope or hex;
- oversized payload;
- digest mismatch;
- malformed JSON or shape;
- wrong source;
- wrong query or order;
- partial expected fence;
- stale fence;
- offset outside the bounded query result.

Limits remain between `1` and `100` rows. The SQL query reads at most `limit + 1` rows to determine continuation.

## Remote acceptance

The guarded main-branch Supabase workflow must prove all of the following from the deployed exact bundle:

1. zero unresolved relative imports;
2. zero Cloudflare runtime imports;
3. qualification-purpose header enforcement;
4. valid Devnet R4C2c fence;
5. two-page committed `validated-ledger` continuation under one immutable fence;
6. deterministic ordering;
7. exact lookup parity;
8. ledger-range parity;
9. digest-tamper rejection;
10. query/order mismatch rejection;
11. cross-source rejection using a correctly re-digested cursor;
12. stale-fence rejection using a correctly re-digested cursor;
13. bounded evidence artifact and Issue #1109 locator.

A remote failure leaves the unit incomplete. Local tests or deployment success without the remote reader verifier do not satisfy G5.

## Unchanged blockers

This unit does not prove:

- non-empty remote evidence for the other six semantic classes;
- relationship reads over non-empty Lending relationships;
- true multi-chunk remote work;
- complete-state export or restore;
- post-restore continuation;
- remote interruption, retry, stale-lease, duplicate, or terminal-injection behavior;
- throughput or sustained Free-plan resources;
- profile selection.

## Production boundary

- public application reader: unchanged and legacy-authoritative;
- public route cutover: no;
- Cloudflare collector restart: no;
- R5 recovery: no;
- Mainnet: no;
- stabilization or soak: no;
- payment method or paid plan: no.
