# Implementation status

Last updated: `2026-08-06`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The selected Supabase revision-3 R5 recovery remains safely halted on the application-owned rolling 31-day egress guard. R5C1 status reconciliation, R5C2 retained byte attribution, R5C3 candidate evaluation, and the R5C4 architecture decision are complete.

Revision-3 recovery continuation is rejected as a convergence path. The immediate engineering phase is **R4F revision-4 qualification**, controlled by Issue `#1261`. G1 locked the directional billable-egress contract, and G2 completed directional metering, canonical evidence retention, deterministic offline shadow generation, and isolated PostgreSQL writer/readback verification. G3 provider reconciliation is active. Revision 4 remains a candidate only: it is not selected and authorizes no R5 mutation.

Issue `#1175` remains the controlling halted R5 recovery record.

Public-reader cutover, Mainnet, stabilization, soak, and restart of the retired Cloudflare collector remain prohibited.

## Roadmap position

```text
M0 foundation                         complete
M1 current-state collector            implemented; runtime replacement/recovery active
M2 event history and lifecycle        complete through Checkpoint B
M3 public API                         complete through exports/feeds; final live cross-audit gated
M4 baseline UI                        complete through Checkpoint C
M5 differentiated audit UI            API cross-audit passed; final browser evidence gated
R4E deployment-profile qualification  revision 3 selected
R5 Devnet recovery                    HALTED — clean rolling-egress boundary
R5C1 status reconciliation            complete
R5C2 retained byte attribution        complete
R5C3 candidate evaluation             complete
R5C4 architecture decision            revision 3 continuation rejected
R4F revision-4 qualification          ACTIVE — G3 provider reconciliation
R5 proof unit / continuation          not authorized
R5 stabilization                      not authorized
M6 hardening / Explorer v1            gated by R5 and stabilization
multi-day Devnet soak                 not authorized
formal Devnet release                 not authorized
O1 -> O2 -> O3 Observatory path       post-release
```

## Selected runtime identity

R4E selected the exact currently deployed profile:

- profile: `supabase_free_postgres_pgcron_edge`;
- revision: `3`;
- profile identity digest: `3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67`;
- R4E selection digest: `13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667`;
- selection commit: `198eae836f5c6814cbc6009c95740becf41bdda3`;
- controlling qualification run: `30817518929`.

Revision 3 remains the identity of the retained halted R5 state. It behaved correctly by denying a claim before mutation. Its fail-closed safety result is preserved even though its recovery accounting is not convergent.

## R5 checkpoint and recovery identity

The retained active checkpoint and recovery are bound to:

- checkpoint ID: `r5-checkpoint-selected-revision3-entry`;
- recovery run ID: `r5-recovery-selected-revision3-entry`;
- network: `devnet`;
- epoch: `supabase-r4c2c-v1`;
- checkpoint watermark: `4,133,101`;
- checkpoint state digest: `8c7ea9e12ae88e98ae54bdeb6b15314d43a993d154b235e5b42be415166a9f35`.

The recovery preserves `scan -> commit -> finalize -> successor`, exact identity checks, parent-hash continuity, and committed-only visibility.

## Latest retained R5 state

Read-only diagnostic run `31032129918` observed:

| Field | Value |
| --- | ---: |
| Recovery status | `halted` |
| Last error | `r5_recovery_monthly_egress_halt` |
| Completed batches | `297` |
| Committed ledgers | `5,811` |
| Recovery watermark | `4,139,118` |
| Physical watermark | `4,139,122` |
| Active batches | `0` |
| Noncommitted work | `0` |
| Nonterminal messages | `20,195` |
| Recent batch errors | none |
| Database bytes | `276,958,355` |

No active batch or partially committed work remains.

## Revision-3 monthly halt

Read-only diagnostic run `31034105841` retained:

| Value | Bytes |
| --- | ---: |
| Attempt conservative bytes | 1,286,596,364 |
| R5 recovery conservative bytes | 2,880,972,004 |
| Prior conservative bytes | 4,167,568,368 |
| One new reservation | 134,217,728 |
| Projected conservative bytes | 4,301,786,096 |
| Fixed halt | 4,294,967,296 |
| Headroom after reservation | -6,818,800 |

The claim was correctly rejected before mutation.

`2026-09-03T10:46:04.042Z` is only the first calculated time one new revision-3 reservation may fit if no new contributions occur. It is not a restart date, completion date, or authorization.

## R5C2 retained attribution

Read-only run `31068546022` reconciled every retained recovery batch:

- executor/adopted batches: `231 / 66`;
- executor/adopted ledgers: `5,076 / 735`;
- recovery conservative bytes: `2,880,972,004`;
- deterministic conservative floor: `2,302,894,080`;
- variable conservative bytes: `578,077,924`;
- retained normalized payload bytes: `5,753,011`;
- full-reservation noncompleted batches: `0`;
- all diagnostic checks: passed.

Three repaired completed batches retain a full 128 MiB failure reservation. They remain valid failure-history accounting but are not ordinary successful-batch cost.

Exact directional wire counters and the original accounting JSON were not retained. No exact provider-egress claim is made.

## R5C3 convergence result

Excluding the three repair-only rows, normal completed work used:

- `2,478,318,820` conservative bytes for `5,016` ledgers;
- approximately `494,083` bytes per ledger;
- approximately `0.195` ledger/minute under the fixed 4 GiB rolling halt.

The qualified steady requirement is `21` ledgers/minute.

The memory-qualified future 12-ledger shape permits approximately `0.109` ledger/minute under revision-3 accounting. Even deleting the entire deterministic floor while retaining the observed variable remainder permits only approximately `2.35` ledgers/minute.

Therefore:

- waiting for one rolling release does not establish convergence;
- removing repair anomalies does not establish convergence;
- reserve tuning alone does not establish convergence;
- 24-ledger claims remain memory-unqualified;
- a one-time rebase without a convergent steady contract is insufficient;
- revision-3 recovery continuation is rejected.

The controlling evaluation is [`ops/r5-egress-candidate-evaluation-2026-08-06.md`](ops/r5-egress-candidate-evaluation-2026-08-06.md).

## R4F revision-4 candidate

Issue `#1261` qualifies a new identity:

- profile: `supabase_free_postgres_pgcron_edge`;
- revision: `4`;
- candidate identity digest: `39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5`;
- selection: `not_selected`;
- recovery mutation authorized: `false`.

G1 separates:

1. rolling billable-egress accounting for documented outbound and conservatively unresolved outbound/internal byte classes; and
2. independent memory/transport accounting for every inbound, outbound, internal, serialized, payload, and object-overhead class.

Inbound XRPL responses are excluded from the rolling billable-egress sum but remain fully included in memory and transport safety. The 4 GiB rolling halt, 224 MiB memory halt, invocation limits, and 12-ledger memory-qualified cap remain unchanged.

The G1 contract is [`docs/ops/r4f-revision4-directional-egress-contract-2026-08-06.md`](docs/ops/r4f-revision4-directional-egress-contract-2026-08-06.md).

## R4F G2 completion

G2 completed the local instrumentation and retention boundary:

- all eight G1 byte directions have typed observations and source-backed framing reserves;
- canonical accounting JSON and SHA-256 digest are deterministic;
- the persistence request resolves its self-referential request-byte field to a stable fixed point;
- candidate evidence is isolated under `xrpl_r4f_v1` with service-role-only writer and reader RPCs;
- the production validated-ledger parser and portable normalizer generate a deterministic two-ledger offline shadow;
- the candidate migration, writer, exact idempotent replay, reader, conflicting-identity rejection, role isolation, and export passed against disposable PostgreSQL 15;
- no Supabase provider connection, production migration, R5 mutation, reader change, Mainnet, stabilization, or soak occurred.

The passing PostgreSQL CI run is `31079355564`, merged through PR `#1266` as commit `0f032f3599ca11df6c8269a1a25eb9aa9f52ae37`.

## R4F remaining gates

- G3: complete one separately authorized bounded provider capture, reconcile provider display intervals, and retain a conservative unexplained-delta reserve;
- G4: memory requalification with inbound XRPL bytes still fully counted;
- G5: prove steady convergence at or above 21 ledgers/minute;
- G6: prove catch-up convergence against a moving Devnet head;
- G7: prove failed, retried, repaired, and adopted accounting;
- G8: reprove export, restore, continuation, rollback, and operator independence;
- G9: run one separately authorized bounded proof unit;
- G10: select or reject revision 4.

No R5 work may resume before G10 selection and a separate bounded-proof authorization.

## R5 exit condition

R5 completes only after:

- Devnet lag reaches zero;
- no skipped or duplicated ledger is proved;
- parent-hash continuity is proved;
- committed-only visibility is proved;
- retry, rollback, lease, interruption, and duplicate replay converge;
- quota accounting reconciles;
- no active or noncommitted recovery work remains;
- a terminal read-only recovery record is retained;
- a separate stabilization decision is prepared.

## Post-R5 order

After R5 exit:

1. separately authorize and run stabilization qualification;
2. complete M5-5 real-data browser regression and representative production behavior smoke;
3. complete early M6 integrity/reset and resource guardrails;
4. implement bounded Explorer v1;
5. run final visual, accessibility, performance, security, and cross-browser audits;
6. finalize canonical host, sitemap, metadata, analytics, and operations documentation;
7. verify backup, restore, rollback, and continuation on the selected production shape;
8. run real multi-day Devnet soak;
9. perform final Devnet release verification;
10. only after stable release and soak, begin Observatory O1, then O2, then O3.

## Controlling evidence

- halted R5 issue: GitHub Issue `#1175`;
- revision-4 qualification: GitHub Issue `#1261`;
- checkpoint and preparation run: `30831843111`;
- health-change diagnostic: `31032129918`;
- monthly halt breakdown: `31034105841`;
- retained attribution: `31068546022`;
- attribution artifact: `8954754584`;
- replan: [`docs/ops/r5-egress-convergence-replan-2026-08-06.md`](docs/ops/r5-egress-convergence-replan-2026-08-06.md);
- candidate decision: [`docs/ops/r5-egress-candidate-evaluation-2026-08-06.md`](docs/ops/r5-egress-candidate-evaluation-2026-08-06.md);
- revision-4 G1 contract: [`docs/ops/r4f-revision4-directional-egress-contract-2026-08-06.md`](docs/ops/r4f-revision4-directional-egress-contract-2026-08-06.md);
- revision-4 G2 meter: [`docs/ops/r4f-g2-directional-meter-2026-08-06.md`](docs/ops/r4f-g2-directional-meter-2026-08-06.md);
- revision-4 G2 persistence: [`docs/ops/r4f-g2-directional-persistence-2026-08-06.md`](docs/ops/r4f-g2-directional-persistence-2026-08-06.md);
- revision-4 G2 offline shadow: [`docs/ops/r4f-g2-offline-shadow-2026-08-06.md`](docs/ops/r4f-g2-offline-shadow-2026-08-06.md);
- revision-4 G2 PostgreSQL readback: [`docs/ops/r4f-g2-postgres-readback-2026-08-06.md`](docs/ops/r4f-g2-postgres-readback-2026-08-06.md);
- revision-4 G3 plan: [`docs/ops/r4f-g3-provider-reconciliation-plan-2026-08-06.md`](docs/ops/r4f-g3-provider-reconciliation-plan-2026-08-06.md);
- runtime invariants: [`history-runtime-contract.md`](history-runtime-contract.md);
- resource boundary: [`resource-envelope.md`](resource-envelope.md).

## Operating restrictions

- Do not restart R5 when rolling revision-3 headroom becomes positive.
- Do not run a revision-3 proof burst.
- Do not describe conservative application accounting as exact provider egress.
- Do not reduce the fixed 4 GiB rolling halt, 224 MiB memory halt, invocation limits, or 12-ledger cap without a new qualification decision.
- Do not exclude inbound bytes from memory or transport accounting.
- Do not skip ledgers, break parent-hash continuity, or replace history with latest-state-only collection.
- Do not rebase without fixed-ledger, manifest, relationship, identity, and continuation evidence.
- Do not restart the retired Cloudflare collector.
- Do not use GitHub Actions as the normal collection clock.
- Do not switch the public reader.
- Do not enable Mainnet.
- Do not start stabilization or soak before separate authorization.
- Do not advance state after partial persistence or silently fall back after an integrity failure.
