# Implementation status

Last updated: `2026-08-07`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The selected Supabase revision-3 R5 recovery remains safely halted on the application-owned rolling 31-day egress guard. R5C1 status reconciliation, R5C2 retained byte attribution, R5C3 candidate evaluation, and the R5C4 architecture decision are complete. Revision-3 continuation is rejected as a convergence path.

The immediate engineering phase is **R4F revision-4 qualification**, controlled by Issue `#1261`.

- G1 directional accounting contract: `pass`;
- G2 instrumentation and retained accounting: `pass`;
- G3 isolated provider reconciliation: `unresolved`;
- G4 memory requalification: `pass`;
- G5-G10: `unresolved`.

G4 is closed from the authorized bounded offline replay retained by Actions run `31086304493` and artifact `8961530550`. The oldest unresolved hard gate remains G3. Revision 4 is still `not_selected` and authorizes no R5 recovery mutation.

Issue `#1175` remains the controlling halted R5 recovery record. Public-reader cutover, Mainnet, stabilization, soak, and restart of the retired Cloudflare collector remain prohibited.

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
R4F revision-4 qualification          ACTIVE — G3 unresolved; G4 pass
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

## R5 checkpoint and retained recovery state

The retained active checkpoint and recovery are bound to:

- checkpoint ID: `r5-checkpoint-selected-revision3-entry`;
- recovery run ID: `r5-recovery-selected-revision3-entry`;
- network: `devnet`;
- epoch: `supabase-r4c2c-v1`;
- checkpoint watermark: `4,133,101`;
- checkpoint state digest: `8c7ea9e12ae88e98ae54bdeb6b15314d43a993d154b235e5b42be415166a9f35`.

The recovery preserves `scan -> commit -> finalize -> successor`, exact identity checks, parent-hash continuity, and committed-only visibility.

Read-only diagnostic run `31032129918` retained:

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

## Revision-3 halt, attribution, and convergence decision

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

The claim was correctly rejected before mutation. `2026-09-03T10:46:04.042Z` is only the first calculated time one new revision-3 reservation may fit if no new contributions occur. It is not a restart date or authorization.

Read-only run `31068546022` reconciled every retained recovery batch:

- executor/adopted batches: `231 / 66`;
- executor/adopted ledgers: `5,076 / 735`;
- recovery conservative bytes: `2,880,972,004`;
- deterministic conservative floor: `2,302,894,080`;
- variable conservative bytes: `578,077,924`;
- retained normalized payload bytes: `5,753,011`;
- full-reservation noncompleted batches: `0`;
- all diagnostic checks: passed.

Three repaired completed batches retain a full 128 MiB failure reservation. They remain valid failure-history accounting but are not ordinary successful-batch cost. Exact directional wire counters and the original accounting JSON were not retained.

Excluding repair-only rows, normal completed work used `2,478,318,820` conservative bytes for `5,016` ledgers, approximately `494,083` bytes per ledger and `0.195` ledger/minute under the fixed 4 GiB rolling halt. The qualified steady requirement is `21` ledgers/minute. The memory-qualified future 12-ledger revision-3 shape permits approximately `0.109` ledger/minute; even deleting the deterministic floor permits only approximately `2.35` ledgers/minute.

Revision-3 continuation is therefore rejected. Waiting for rolling release, removing anomalies, reserve tuning, restoring unqualified 24-ledger claims, or performing a one-time rebase does not prove convergence.

## R4F revision-4 candidate

Issue `#1261` qualifies a new identity:

- profile: `supabase_free_postgres_pgcron_edge`;
- revision: `4`;
- candidate identity digest: `39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5`;
- selection: `not_selected`;
- recovery mutation authorized: `false`.

The fixed guards remain:

- rolling application egress halt: `4 GiB / 31 days`;
- memory halt: `224 MiB` (`234881024` bytes);
- invocation halt: `400,000 / 31 days`;
- memory-qualified claim cap: `12 ledgers`.

G1 separates rolling billable-direction egress from independent memory/transport accounting. Inbound XRPL responses are excluded from the rolling billable-egress sum but remain fully included in memory and transport safety.

## R4F G2 completion

G2 completed:

- all eight G1 byte directions with typed observations and source-backed framing reserves;
- deterministic canonical accounting JSON and SHA-256 digest;
- candidate-only persistence under `xrpl_r4f_v1`;
- deterministic production-parser/source-shaped offline shadow generation;
- isolated PostgreSQL 15 migration, writer, idempotent replay, reader, conflict rejection, role isolation, and export verification.

The passing PostgreSQL CI run is `31079355564`, merged through PR `#1266` as commit `0f032f3599ca11df6c8269a1a25eb9aa9f52ae37`. No production Supabase migration, R5 mutation, reader change, Mainnet, stabilization, or soak occurred.

## R4F G3 status

G3 remains `unresolved`.

The provider interval reconciliation contract, unexplained-delta arithmetic, bounded Dashboard capture contract, and offline verifier are prepared. No separately authorized isolated Supabase Dashboard before/after capture has been retained, and synthetic evidence cannot satisfy this gate.

## R4F G4 completion

G4 is `pass`.

The authorized bounded offline replay ran on source commit `5a25d091919dc2d90116ca9cc4e92335031be9f2` in Actions run `31086304493`. Both `quality` and `r4f-g4-memory-replay` completed successfully.

Retained artifact:

- name: `r4f-g4-memory-replay-evidence`;
- artifact ID: `8961530550`;
- size: `160152` bytes;
- digest: `sha256:e0b4157b70faea269c61f643b78882dffb30a9168632c77e5ec6972673009ed7`;
- expiration: `2026-08-20T08:47:12Z`;
- verifier: `proofReady: true`;
- blocking reasons: none.

Measured shapes:

| Shape | Baseline RSS | Peak RSS | Headroom | Retained / processed |
| --- | ---: | ---: | ---: | ---: |
| exact 12-ledger | 61,845,504 | 77,430,784 | 157,450,240 | 12 / 12 |
| heavier retained | 59,494,400 | 75,296,768 | 159,584,256 | 24 / 12 |

The maximum peak was `77430784` bytes and the minimum headroom below the unchanged `234881024`-byte halt was `157450240` bytes. No memory-halt recurrence or claim-cap override occurred.

The official artifact download and the retained owner-supplied copy are byte-identical. All 24 source ledger JSON files match the retained source manifest by size and SHA-256.

Closure records:

- [`docs/ops/r4f-g4-memory-gate-closure-2026-08-07.md`](ops/r4f-g4-memory-gate-closure-2026-08-07.md);
- [`ops/r4f/revision4-memory-gate-closure.json`](../ops/r4f/revision4-memory-gate-closure.json).

G4 completion does not satisfy G3 or G5-G10, select revision 4, authorize R5 recovery, or change the public reader, Mainnet, stabilization, or soak state.

## R4F remaining gates

- G3: complete one separately authorized bounded provider capture, reconcile provider display intervals, and retain a conservative unexplained-delta reserve;
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
- replan: [`ops/r5-egress-convergence-replan-2026-08-06.md`](ops/r5-egress-convergence-replan-2026-08-06.md);
- candidate decision: [`ops/r5-egress-candidate-evaluation-2026-08-06.md`](ops/r5-egress-candidate-evaluation-2026-08-06.md);
- revision-4 G1 contract: [`ops/r4f-revision4-directional-egress-contract-2026-08-06.md`](ops/r4f-revision4-directional-egress-contract-2026-08-06.md);
- revision-4 G2 meter: [`ops/r4f-g2-directional-meter-2026-08-06.md`](ops/r4f-g2-directional-meter-2026-08-06.md);
- revision-4 G2 persistence: [`ops/r4f-g2-directional-persistence-2026-08-06.md`](ops/r4f-g2-directional-persistence-2026-08-06.md);
- revision-4 G2 offline shadow: [`ops/r4f-g2-offline-shadow-2026-08-06.md`](ops/r4f-g2-offline-shadow-2026-08-06.md);
- revision-4 G2 PostgreSQL readback: [`ops/r4f-g2-postgres-readback-2026-08-06.md`](ops/r4f-g2-postgres-readback-2026-08-06.md);
- revision-4 G3 plan: [`ops/r4f-g3-provider-reconciliation-plan-2026-08-06.md`](ops/r4f-g3-provider-reconciliation-plan-2026-08-06.md);
- revision-4 G4 contract: [`ops/r4f-g4-memory-evidence-contract-2026-08-06.md`](ops/r4f-g4-memory-evidence-contract-2026-08-06.md);
- revision-4 G4 closure: [`ops/r4f-g4-memory-gate-closure-2026-08-07.md`](ops/r4f-g4-memory-gate-closure-2026-08-07.md);
- revision-4 G4 machine closure: [`../ops/r4f/revision4-memory-gate-closure.json`](../ops/r4f/revision4-memory-gate-closure.json);
- runtime invariants: [`history-runtime-contract.md`](history-runtime-contract.md);
- resource boundary: [`resource-envelope.md`](resource-envelope.md).

## Operating restrictions

- Do not restart R5 under revision 3 or when rolling revision-3 headroom first becomes positive.
- Do not run a revision-3 proof burst.
- Do not describe conservative application accounting as exact provider egress.
- Do not reduce the fixed 4 GiB rolling halt, 224 MiB memory halt, 400,000 invocation halt, or 12-ledger cap.
- Do not exclude inbound bytes from memory or transport accounting.
- Do not satisfy G3 without real bounded provider evidence.
- Do not skip ledgers, break parent-hash continuity, or replace history with latest-state-only collection.
- Do not rebase without fixed-ledger, manifest, relationship, identity, and continuation evidence.
- Do not restart the retired Cloudflare collector or use GitHub Actions as the normal collection clock.
- Do not switch the public reader, enable Mainnet, or start stabilization or soak.
- Do not advance state after partial persistence or silently fall back after an integrity failure.
