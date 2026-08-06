# R4F G2B directional evidence persistence

Date: `2026-08-06`.
Qualification issue: `#1261`.
Gate: `G2 — instrumentation`.
Unit: `G2B — candidate-only persistence contract`.

## Status

G2B adds a private candidate-only persistence schema and exact writer/reader RPC contracts.

G2 remains **unresolved**. No revision-4 shadow runtime has written production evidence, revision 4 remains unselected, and R5 recovery mutation remains unauthorized.

## Migration

The migration is:

- `supabase/migrations/20260806120000_xrpl_r4f_revision4_directional_accounting_evidence.sql`.

It creates:

- schema `xrpl_r4f_v1`;
- table `directional_accounting_evidence`;
- table `directional_accounting_observations`;
- writer RPC `public.xrpl_record_r4f_revision4_directional_accounting`;
- reader RPC `public.xrpl_read_r4f_revision4_directional_accounting`.

## Isolation

The schema and both tables revoke access from:

- `public`;
- `anon`;
- `authenticated`.

Only `service_role` receives schema usage, table select/insert, and RPC execution.

The migration contains no reference to:

- `xrpl_r5_v1`;
- revision-3 recovery batches or runs;
- phase work, payload, or reference tables;
- collector cursors or watermarks;
- public-reader bindings;
- deployment or secret state.

The writer inserts only into the two `xrpl_r4f_v1` tables. It performs no update, delete, truncate, claim, completion, cursor advance, or reader change.

## Retained evidence

One evidence row retains:

- exact revision-4 profile ID, revision, and identity digest;
- observation and attempt identity;
- canonical UTC observation time;
- completed, failed, retry, repair, or adopted shadow disposition;
- exact canonical accounting JSON string;
- SHA-256 digest;
- observation count;
- directional wire total;
- rolling billable-egress upper bound;
- memory/transport upper bound;
- unexplained directional delta reserve;
- memory supplemental accounting;
- safety checks;
- source GitHub run and source commit;
- explicit no-mutation and release-boundary flags.

Each observation row retains:

- contiguous sequence;
- stable non-secret operation ID;
- one exact G1 boundary ID;
- body bytes;
- framing reserve bytes;
- generated total bytes;
- rolling billable-egress bytes;
- memory/transport bytes;
- directional inclusion flags.

## Database-side verification

The writer does not trust caller totals. Before insertion it recomputes and verifies:

1. SHA-256 of the exact accounting JSON string;
2. exact revision-4 profile identity;
3. canonical observation and attempt identifiers;
4. canonical UTC observation time;
5. supported disposition;
6. every required safety flag;
7. observation array shape;
8. contiguous zero-based sequence;
9. unique operation IDs;
10. supported G1 boundary IDs;
11. non-negative JavaScript-safe integer body and framing bytes;
12. rolling inclusion by boundary;
13. directional rolling total;
14. directional memory total;
15. unexplained reserve;
16. memory supplemental totals;
17. top-level rolling and memory totals.

Inbound boundaries are exactly:

- `invoker_to_edge_request`;
- `xrpl_to_edge_response`.

They contribute zero to rolling billable egress and their full body plus framing bytes to memory/transport.

## Idempotency

Repeating the same observation ID with the same digest returns an idempotent success and writes nothing new.

Repeating the same observation ID with a different digest fails with `observation_identity_conflict`.

The child table also enforces unique sequence and operation identity.

## Reader

The service-role-only reader returns:

- retained evidence;
- observations ordered by sequence;
- exact profile identity check;
- observation-count reconciliation;
- no-mutation and release-boundary flags.

G2D will add full JSON/digest and byte-total readback verification after G2C writes one separately authorized shadow record.

## Validation

`src/shared/supabase-revision4-directional-persistence-contract.test.ts` statically proves:

- exact private schema and table contract;
- exact profile identity and every G1 boundary;
- database-side digest and total recomputation;
- idempotency and conflict rejection;
- public-role revocation and service-role-only execution;
- absence of active R5, phase, cursor, reader, and deployment references;
- absence of writer update, delete, and truncate operations.

The repository CI migration replay must prove the SQL applies cleanly from an empty local database.

## Remaining G2 units

- G2C: separately authorized read-only shadow runtime;
- G2D: readback, digest, directional-total, export, and safety-boundary verification.

G2 passes only after G2C and G2D retain and verify one complete source-shaped record without R5 mutation.

## Restrictions

- Do not deploy or invoke the writer as part of active revision-3 R5.
- Do not grant public, anon, or authenticated access.
- Do not write into revision-3 recovery or phase tables.
- Do not treat a locally replayed migration as provider evidence.
- Do not treat retained shadow bytes as provider-reported egress.
- Do not weaken fixed resource guards.
- Do not switch the public reader, enable Mainnet, start stabilization, or start soak.
