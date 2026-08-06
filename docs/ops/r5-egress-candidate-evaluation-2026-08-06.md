# R5 egress candidate evaluation

Date: `2026-08-06`.

## Decision

R5C2 and R5C3 are complete.

The selected Supabase revision-3 profile remains the active fail-closed runtime identity for the halted R5 state, but **revision-3 recovery continuation is rejected as a convergence path**. No further revision-3 recovery mutation is authorized.

R4F Issue `#1261` now controls qualification of a new revision-4 candidate. Revision 4 is not selected and does not authorize R5 restart.

## Retained evidence

Read-only run `31068546022` reconciled all retained R5 recovery batches:

- completed executor batches: `231`;
- adopted zero-egress batches: `66`;
- executor/adopted ledgers: `5,076 / 735`;
- recovery conservative bytes: `2,880,972,004`;
- deterministic conservative floor: `2,302,894,080`;
- unretained variable conservative bytes: `578,077,924`;
- retained normalized payload bytes: `5,753,011`;
- full-reservation noncompleted batches: `0`;
- attribution reconciliation: passed.

The retained evidence does not contain exact per-direction XRPL or claim-RPC wire counters. It supports deterministic reserve reconstruction and aggregate variable-wire reconstruction only.

## Repair-only full reservations

Three completed batches retained the full `134,217,728`-byte failure reservation:

| Batch sequence | Ledger range | Ledger count | Cause |
| ---: | --- | ---: | --- |
| 87 | `4,135,113..4,135,136` | 24 | pending-scan descendant repair |
| 238 | `4,138,338..4,138,361` | 24 | memory-halt descendant repair |
| 245 | `4,138,468..4,138,479` | 12 | memory-halt retry/repair |

Together they contribute `402,653,184` bytes, or `13.98%` of total R5 recovery accounting. Their variable remainder is `372,842,496` bytes, or `64.50%` of all retained variable bytes.

These rows remain correct historical failure accounting. They are not representative ordinary-success cost and must not be projected as the normal cost of future completed batches.

## Normal completed-work baseline

Excluding the three repair-only full-reservation rows:

- batches: `228`;
- ledgers: `5,016`;
- conservative bytes: `2,478,318,820`;
- deterministic floor: `2,273,083,392`;
- variable conservative bytes: `205,235,428`;
- deterministic share: `91.72%`;
- average total: approximately `494,083` bytes per ledger;
- average variable remainder: approximately `40,916` bytes per ledger.

Future claims are capped at 12 ledgers because retained 24-ledger work exceeded the selected memory bound. The observed normal 12-ledger shape averages approximately `882,493` conservative bytes per ledger.

## Required steady envelope

The qualified steady demand remains `21` ledgers per minute.

A 31-day window contains `44,640` minutes, so steady operation must cover `937,440` ledgers in one rolling window. With the unchanged 4 GiB project halt, the complete billable-direction upper bound must average no more than approximately `4,582` bytes per ledger, including intervention headroom.

## Candidate results

| Candidate | Result | Reason |
| --- | --- | --- |
| Wait until `2026-09-03T10:46:04.042Z` and continue revision 3 | Reject | The timestamp only permits one new reservation. It does not prove backlog closure or steady convergence. |
| Remove the three repair-only full reservations from future projection | Reject as sufficient solution | The remaining normal mix permits only approximately `0.195` ledger/minute, about `108x` below the required 21/minute. |
| Restore 24-ledger claims | Reject | 24-ledger work is memory-unqualified. Even its current accounting permits only approximately `0.211` ledger/minute. |
| Keep only the observed normal variable remainder and delete the entire deterministic floor | Reject as sufficient solution | The theoretical result is only approximately `2.35` ledgers/minute, about `8.93x` below the required 21/minute. |
| Reduce the fixed 4 GiB halt or omit inbound bytes from memory accounting | Prohibited | This weakens the selected no-charge or runtime-safety boundary rather than proving a new contract. |
| Split the same bytes across more invocations | Reject | It changes scheduling, not total rolling bytes, and increases invocation pressure. |
| Rebase to a newer checkpoint without changing steady accounting | Reject as sufficient solution | A rebase may reduce historical backlog once, but the current steady cost still cannot follow a moving Devnet head. |
| Qualify revision 4 with directional billable-egress and independent memory/transport accounting | Proceed to qualification | Supabase documents egress as data transmitted out of the platform to connected clients. The revision-3 blanket all-direction formula includes large inbound XRPL responses and cannot prove steady convergence. |

## R5C4 decision

The selected decision is:

1. preserve the clean halted revision-3 R5 boundary;
2. reject revision-3 continuation as a convergence path;
3. create a new revision-4 profile identity;
4. retain the fixed 4 GiB rolling halt, 224 MiB memory halt, invocation guards, and 12-ledger memory-qualified claim cap;
5. separate billable-direction egress accounting from memory/transport accounting;
6. qualify revision 4 through G1-G10 in Issue `#1261`;
7. authorize no R5 proof unit until revision 4 is explicitly selected.

## Revision-4 qualification requirement

Revision 4 must prove both:

- **no-charge safety:** its directional billable-egress upper bound remains below the unchanged rolling halt;
- **runtime safety:** every inbound, outbound, internal, serialized-live, retained-payload, and object-overhead class remains inside the unchanged memory and execution guards.

Excluding inbound XRPL responses from the rolling billable-egress sum does not exclude them from memory, payload, request, transaction, metadata, or wall-time controls.

## Source boundary

Official Supabase documentation used for G1 states that egress is network data transmitted out of the system to a connected client and identifies database and Edge Function responses sent to clients as egress:

- `https://supabase.com/docs/guides/platform/manage-your-usage/egress`
- `https://supabase.com/docs/guides/troubleshooting/all-about-supabase-egress-a_Sg_e`

G3 must still reconcile the exact selected architecture's internal database, function-to-function, and outbound external-request treatment. Until then, unresolved outbound/internal classes remain conservatively included.

## Restrictions

- no automatic R5 restart;
- no revision-3 proof burst;
- no resource-limit reduction;
- no provider counter claim where the provider surface is unavailable;
- no latest-state-only shortcut or skipped historical ledger;
- no public-reader cutover;
- no Mainnet;
- no stabilization or soak;
- no retired Cloudflare collector restart.
