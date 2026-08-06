# R4F revision-4 directional egress contract

Date: `2026-08-06`.
Qualification issue: `#1261`.
Gate: `G1 — contract lock`.

## Status

G1 defines a new candidate identity and byte-direction contract. It does not select revision 4 and does not authorize R5 recovery mutation.

- profile ID: `supabase_free_postgres_pgcron_edge`;
- revision: `4`;
- profile identity digest: `39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5`;
- selection: `not_selected`;
- recovery mutation authorized: `false`.

The machine-readable contract is `src/shared/supabase-revision4-directional-egress-contract.ts`.

## Reason for a new identity

Revision 3 uses one conservative formula that multiplies aggregate network request, network response, database request, database response, and function response wire bytes. That contract correctly failed closed, but retained R5 evidence proves it cannot satisfy the required steady ledger rate inside the fixed rolling halt.

Supabase documentation defines egress as network data transmitted out of the system to connected clients. Revision 4 therefore separates:

1. a directional upper bound for rolling billable egress; and
2. an independent memory/transport upper bound covering every byte direction.

This changes the accounting contract materially and requires a new profile revision and complete G1-G10 qualification.

## Fixed guards

Revision 4 inherits these limits unchanged:

| Guard | Candidate value |
| --- | ---: |
| Provider memory hard boundary | 256 MiB |
| Project memory halt | 224 MiB |
| Provider egress Free boundary | 5 GiB |
| Project rolling egress halt | 4 GiB |
| Provider invocations boundary | 500,000 / 31 days |
| Project invocations halt | 400,000 / 31 days |
| Memory-qualified maximum ledgers per claim | 12 |

G1 does not reduce the current 128 MiB revision-3 recovery reservation. G2-G7 must replace it only with source-backed directional and failure-accounting bounds before revision 4 can be selected.

## Accounting contracts

### Rolling billable-egress upper bound

Count only:

- documented data sent from Supabase to connected clients;
- external outbound request classes conservatively included until provider reconciliation;
- unresolved internal database and function-to-function classes conservatively included until G3;
- source-backed framing and unexplained-delta reserves.

Do not count inbound external responses merely because they are large.

A blanket multiplier over every network direction is prohibited.

### Memory and transport upper bound

Count all relevant classes regardless of billable direction:

- inbound and outbound request and response bodies;
- database requests and responses;
- function-to-function requests and responses;
- canonical JSON and payload serialization;
- ledger, transaction, metadata-node, normalized-record, payload-chunk, and relationship overhead;
- retained failure and retry state;
- source-backed framing, allocator, and unexplained-delta reserves.

No byte may disappear from memory/transport accounting because it is excluded from rolling billable egress.

## Boundary table

| Boundary | Platform direction | Rolling egress | Memory/transport | G1 disposition |
| --- | --- | --- | --- | --- |
| invoker → Edge request | inbound | exclude | include | locked |
| Edge → invoker response | outbound | include | include | documented outbound |
| Edge → XRPL request | outbound | include conservatively | include | G3 required |
| XRPL → Edge response | inbound | exclude | include | locked |
| Edge → database request | internal/unresolved | include conservatively | include | G3 required |
| database → Edge response | internal/unresolved | include conservatively | include | G3 required |
| Edge → Edge request | internal/unresolved | include conservatively | include | G3 required |
| Edge → Edge response | internal/unresolved | include conservatively | include | G3 required |

## Provider claims

G1 relies on official documentation for the general outbound-to-client definition:

- `https://supabase.com/docs/guides/platform/manage-your-usage/egress`
- `https://supabase.com/docs/guides/troubleshooting/all-about-supabase-egress-a_Sg_e`

G1 does not claim that provider counters expose the exact selected workload's bytes, and it does not claim that unresolved internal or outbound classes are free. G3 must retain an unexplained-delta reserve and reject the candidate if provider reconciliation remains too coarse to establish a safe bound.

## Required instrumentation for G2

Every attempt must retain, by boundary and direction:

- exact UTF-8 body bytes;
- request and response framing reserve;
- source and destination class;
- whether the byte contributes to rolling billable egress;
- whether the byte contributes to memory/transport;
- accounting schema version;
- canonical accounting JSON and digest;
- failed, retried, repaired, adopted, and completed disposition.

The original accounting JSON must be retained. A digest alone is insufficient for future attribution.

## Gates remaining

- G2 instrumentation;
- G3 isolated provider reconciliation;
- G4 memory requalification;
- G5 steady convergence;
- G6 catch-up convergence;
- G7 failure accounting;
- G8 restore and operator independence;
- G9 one bounded proof unit;
- G10 selection decision.

Until G10 selects revision 4, Issue `#1175` remains halted under revision 3.

## Prohibited changes

- no R5 restart or proof burst;
- no public-reader change;
- no Mainnet;
- no stabilization or soak;
- no fixed-guard reduction;
- no 24-ledger claim restoration without memory requalification;
- no inbound-byte omission from memory/transport;
- no provider-measurement claim unsupported by the provider surface;
- no history skipping, continuity break, or latest-state-only substitute.
