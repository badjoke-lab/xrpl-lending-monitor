# R4C3 Supabase revision-3 resource-accounting contract

Date: `2026-08-03`

## Purpose

Supabase revision 2 was rejected because required provider peak-memory and egress counters were unavailable. Revision 3 does not reinterpret those missing counters as measured evidence.

Revision 3 uses a distinct profile identity and a conservative application-owned accounting model that:

- counts every application-visible network direction;
- amplifies serialized live bytes;
- adds fixed per-object overhead;
- reserves a large fixed runtime-memory amount;
- accumulates conservative 31-day egress and invocation upper bounds;
- halts before project ceilings that remain below provider hard ceilings;
- makes its decision before collector mutation.

This contract is only the first R4C3 unit. It does not qualify G8, select the profile, or authorize R5.

## Profile identity

- profile ID: `supabase_free_postgres_pgcron_edge`;
- revision: `3`;
- identity digest: `3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67`;
- status: `unqualified`;
- selected: `false`.

The execution component explicitly includes conservative application-owned resource accounting. Revision-2 evidence must be rebound or rerun before it can support revision 3.

## Memory upper bound

Provider hard memory: `256 MiB`.

Project memory halt: `224 MiB`.

The application-owned upper bound is:

```text
192 MiB fixed runtime reserve
+ 8 × serialized live bytes
+ per-ledger object overhead
+ per-transaction object overhead
+ per-metadata-node overhead
+ per-normalized-record overhead
+ per-payload-chunk overhead
+ per-relationship overhead
```

The fixed reserve is not described as measured runtime usage. It is a deliberately large unobserved-runtime allowance.

Serialized live bytes include:

- XRPL response bodies;
- database request bodies;
- database response bodies;
- canonical work JSON;
- encoded payload bytes.

Object overheads are added even when their serialized bytes are already counted. This intentional double counting creates a conservative upper bound.

A tick fails when the calculated upper bound is greater than or equal to `224 MiB`. The remaining `32 MiB` to the provider hard limit is not consumed by the project budget.

## Egress upper bound

Provider 31-day egress hard ceiling: `5 GiB`.

Project 31-day egress halt: `4 GiB`.

Project per-tick egress halt: `32 MiB`.

The conservative tick egress upper bound is:

```text
4 × exact application-visible wire bytes
+ 16 KiB × network requests
+ 8 KiB × database requests
+ 64 KiB fixed tick overhead
```

Exact application-visible wire bytes include:

- network request bodies;
- network response bodies;
- database request bodies;
- database response bodies;
- function response bodies.

The model counts inbound and outbound bytes even when a provider might charge only one direction. Request counts are not substituted for egress bytes; they contribute additional fixed overhead after exact visible bytes are counted.

A tick fails when its conservative upper bound reaches `32 MiB` or when the rolling 31-day conservative total reaches `4 GiB`.

## Invocation boundary

Provider hard ceiling: `500,000` invocations per 31 days.

Project halt: `400,000` invocations per 31 days.

The accounting decision includes the proposed current invocation before allowing mutation.

## Object-count limits

Revision 3 rejects a tick above any of these limits:

| Class | Maximum per tick |
| --- | ---: |
| Ledgers | 24 |
| Network requests | 64 |
| Database requests | 16 |
| Transactions | 4,096 |
| Metadata nodes | 32,768 |
| Normalized records | 16,384 |
| Payload chunks | 1,024 |
| Relationships | 65,536 |

These limits prevent an attacker-controlled or unexpectedly large ledger payload from bypassing byte accounting through pathological object fan-out.

## Required next implementation units

1. Instrument the network and database wrappers to count exact visible bytes.
2. Count ledgers, transactions, metadata nodes, normalized records, chunks, and relationships.
3. Calculate the revision-3 decision after normalization and before resource-accounting persistence or collector completion.
4. Persist safe accounting evidence bound to session, tick, work range, profile revision, and identity digest.
5. Add a pre-completion database trigger that rejects missing, unsafe, stale, or identity-mismatched accounting evidence.
6. Add rolling 31-day pre-claim guards for conservative egress and invocation totals.
7. Add isolated threshold-injection qualifications for every byte, object, memory, egress, and invocation boundary.
8. Run a real six-minute steady qualification and a catch-up qualification with revision-3 evidence.
9. Rebind or rerun G1–G10 and evaluate the exact profile.

## Fixed interpretation

Revision 3 must always report:

- provider exact peak memory measured: `false`;
- provider egress measured: `false`;
- application-owned conservative memory upper bound: available only when all inputs are accounted;
- application-owned conservative egress upper bound: available only when all visible network directions and rolling totals are accounted;
- profile selected: `false` until all hard gates pass.

## Production restrictions

Until revision 3 is qualified and explicitly selected:

- the legacy public reader remains authoritative;
- the retired Cloudflare collector remains halted;
- Mainnet remains disabled;
- R5 recovery remains prohibited;
- stabilization and soak remain prohibited.
