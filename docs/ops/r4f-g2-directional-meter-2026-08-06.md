# R4F G2A directional accounting meter

Date: `2026-08-06`.
Qualification issue: `#1261`.
Gate: `G2 — instrumentation`.
Unit: `G2A — shared meter and canonical evidence shape`.

## Status

G2A defines and tests the shared directional meter and canonical accounting evidence shape.

G2 remains **unresolved**. The meter is not wired into the active revision-3 R5 executor, no production table or RPC retains revision-4 observations, and no recovery mutation is authorized.

## Delivered contract

The shared module is:

- `src/shared/supabase-revision4-directional-meter.ts`.

It provides:

- exact UTF-8 body-byte measurement;
- one explicit G1 boundary ID per operation;
- explicit framing reserve per operation;
- stable non-secret operation IDs;
- contiguous observation sequence;
- duplicate-operation rejection;
- directional rolling-egress summary;
- independent memory/transport summary;
- explicit unexplained-directional-delta reserve;
- canonical retained accounting JSON;
- SHA-256 accounting digest;
- completed, failed, retry, repair, and adopted shadow dispositions;
- hard assertions that no recovery, public-reader, Mainnet, stabilization, or soak mutation occurred.

## Accounting output

One evidence object contains:

- exact revision-4 profile identity;
- observation and attempt IDs;
- canonical UTC observation time;
- disposition;
- ordered directional observations;
- per-boundary body and framing bytes;
- rolling billable-egress upper bound;
- memory/transport upper bound;
- canonical JSON and digest;
- safety checks.

The rolling upper bound is:

```text
sum(documented outbound classes)
+ sum(conservatively unresolved outbound/internal classes)
+ unexplained directional delta reserve
```

The memory/transport upper bound is:

```text
sum(all directional body and framing bytes)
+ canonical JSON bytes
+ retained payload bytes
+ normalized object overhead
+ allocator reserve
```

Inbound XRPL responses contribute zero to the rolling billable-egress sum and their full body plus framing bytes to memory/transport.

## Machine-readable fixture

`ops/r4f/revision4-directional-meter-fixture.json` covers every G1 boundary exactly once.

The fixture produces:

- rolling billable-egress upper bound: `12,474` bytes;
- memory/transport upper bound: `79,354` bytes;
- recovery mutation committed: `false`;
- public reader unchanged: `true`;
- Mainnet disabled: `true`;
- stabilization authorized: `false`;
- soak authorized: `false`.

The fixture values are synthetic contract evidence, not provider usage evidence and not a production workload forecast.

## Isolation

`src/shared/supabase-revision4-directional-meter-isolation.test.ts` proves:

- the active revision-3 R5 executor does not import the revision-4 meter;
- the active trigger does not bind the revision-4 identity;
- the active executor remains bound to `r5-recovery-selected-revision3-entry` and revision 3.

This prevents an unselected candidate from entering the halted production recovery path.

## Test coverage

Tests require:

- UTF-8 bytes rather than JavaScript character count;
- inbound XRPL bytes excluded only from rolling egress;
- inbound XRPL bytes retained in memory/transport;
- documented and unresolved outbound classes counted conservatively;
- explicit framing reserves;
- canonical accounting JSON and stable digest;
- all G1 boundaries represented by the fixture;
- failed disposition retained without mutation;
- invalid identifiers, duplicate operations, broken sequence, overflow, and safety-boundary changes rejected;
- active revision-3 executor isolation.

## Remaining G2 units

### G2B — Persistence contract

Add a candidate-only retention schema and RPC contract that stores:

- exact revision-4 identity;
- canonical accounting JSON and digest;
- ordered observations;
- directional and memory totals;
- disposition;
- source run and commit evidence;
- no-mutation safety flags.

The schema must have no public grants and must not update revision-3 R5 run, batch, cursor, work, or public-reader state.

### G2C — Read-only shadow runtime

Build a separately authorized shadow path that exercises the same source-shaped request and normalization flow without claiming or completing an R5 batch.

It must:

- bind a fixed ledger range or retained fixture;
- record every request and response direction;
- retain canonical accounting JSON;
- retain no secrets or provider identifiers in public evidence;
- make no recovery, cursor, checkpoint, reader, deployment, Mainnet, stabilization, or soak mutation.

### G2D — Retention verification

Read the retained G2 records back and prove:

- JSON/digest parity;
- complete direction coverage;
- contiguous observation sequence;
- exact byte-total reconciliation;
- disposition and safety-boundary parity;
- deterministic exportability.

## G2 exit condition

G2 passes only after G2A through G2D are complete and evidence proves that every relevant selected-runtime byte boundary is measured or conservatively reserved, retained as canonical JSON, and independently reconstructable.

Until then:

- revision 4 remains `conditional_candidate`;
- G2 remains `unresolved`;
- no scoring is allowed;
- no G3 provider reconciliation is final;
- no R5 proof or recovery mutation is authorized.

## Restrictions

- Do not import the meter into the active revision-3 executor.
- Do not deploy a revision-4 Edge Function during G2A.
- Do not write revision-4 observations into revision-3 recovery tables.
- Do not treat fixture output as provider egress.
- Do not omit inbound bytes from memory/transport.
- Do not weaken the 4 GiB, 224 MiB, invocation, or 12-ledger guards.
- Do not switch the public reader, enable Mainnet, start stabilization, or start soak.
