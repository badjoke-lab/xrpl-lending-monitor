# Implementation status

Last updated: `2026-08-06`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The controlling engineering phase is R5 recovery under the selected Supabase revision-3 profile. The recovery is currently **safely halted** by the application-owned rolling 31-day egress guard. The immediate unit is `R5C1`: reconcile status and resource documents, then prove whether the current recovery shape can converge under the unchanged free-tier guard.

The controlling issue is `#1175`, **R5 Supabase revision-3 recovery to Devnet lag zero**.

Public-reader cutover, Mainnet, stabilization, soak, and restart of the retired Cloudflare collector remain prohibited.

## Roadmap position

```text
M0 foundation                         complete
M1 current-state collector            implemented; runtime replacement/recovery active
M2 event history and lifecycle        complete through Checkpoint B
M3 public API                         complete through exports/feeds; final live cross-audit gated
M4 baseline UI                        complete through Checkpoint C
M5 differentiated audit UI            API cross-audit passed; final browser evidence gated
R4 deployment-profile qualification   revision 3 selected
R5 Devnet recovery                    ACTIVE — halted on rolling egress guard
R5 stabilization                      not authorized
M6 hardening / Explorer v1            gated by R5 and stabilization
multi-day Devnet soak                 not authorized
formal Devnet release                 not authorized
O1 -> O2 -> O3 Observatory path       post-release
```

## Selected profile

R4E selected the exact profile:

- profile: `supabase_free_postgres_pgcron_edge`;
- revision: `3`;
- profile identity digest: `3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67`;
- R4E selection digest: `13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667`;
- selection commit: `198eae836f5c6814cbc6009c95740becf41bdda3`;
- controlling qualification run: `30817518929`.

Revision 3 uses conservative application-owned accounting and fail-closed pre-reservation where provider counters are unavailable. Missing provider counters are not relabeled as measured values.

## R5 checkpoint and recovery identity

The retained active checkpoint and recovery are bound to:

- checkpoint ID: `r5-checkpoint-selected-revision3-entry`;
- recovery run ID: `r5-recovery-selected-revision3-entry`;
- network: `devnet`;
- epoch: `supabase-r4c2c-v1`;
- checkpoint watermark: `4,133,101`;
- checkpoint state digest: `8c7ea9e12ae88e98ae54bdeb6b15314d43a993d154b235e5b42be415166a9f35`.

The recovery preserves the standard `scan -> commit -> finalize -> successor` contract and committed-only visibility.

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

The status change from `running` to `halted` and the corresponding last error are the only retained health mismatches. No active batch or partially committed work remains.

## Monthly egress halt

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

The next claim was correctly rejected before mutation.

The calculated first release time, assuming no new contributions, is `2026-09-03T10:46:04.042Z`. This is only the first time one new 128 MiB reservation would fit. It is not an R5 completion date and does not authorize automatic restart.

These values are conservative application accounting, not exact provider-reported egress.

## Convergence blocker

The completed sample used `2,880,972,004` conservative bytes for `5,811` committed ledgers, or approximately `495,779` bytes per ledger on average.

The last retained live lag observation before the halt was `93,539` ledgers. Applying the observed average as a planning signal produces approximately `43.19 GiB`, or `10.80` times the fixed 4 GiB rolling halt.

This is not a formal worst-case forecast: ledger contents vary and the Devnet head continues to move. It is sufficient to reject the assumption that one rolling-window release automatically makes the existing recovery convergent.

Revision 3 remains selected and correctly fail-closed. The unresolved gate is now whether the current recovery execution shape can close a moving backlog under the unchanged resource boundary.

## Current unit — R5C1

The controlling plan is [`ops/r5-egress-convergence-replan-2026-08-06.md`](ops/r5-egress-convergence-replan-2026-08-06.md).

R5C1 requires:

1. align this status document, `resource-envelope.md`, the replan, and Issue `#1175`;
2. preserve the clean halted boundary;
3. prohibit automatic restart at the first release time;
4. keep all fixed resource and release boundaries unchanged.

## Next units

### R5C2 — Read-only byte attribution

Reconcile retained conservative bytes by XRPL response, scan, transaction/metadata payload, emitted phase payload, failed-attempt reservation, database contribution where included, and fixed slack. Use retained artifacts first and create no recovery mutation for measurement.

### R5C3 — Candidate evaluation

Evaluate duplicate source-read removal, reuse of already proved committed data, payload reduction with exact reconstruction, explicit verified rebase, and whether any changed execution contract requires profile revision 4.

### R5C4 — Selection decision

Continue revision 3 only if a conservative upper bound proves moving-head convergence with unchanged or stricter guards. Otherwise define revision 4 and rerun G1-G10 before production recovery resumes.

### R5C5 — One bounded proof burst

After explicit selection, run one bounded proof unit and reconcile watermark, head, lag slope, conservative bytes, state-machine transition, rolling headroom, continuity, and committed-only visibility before authorizing continued recovery.

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

- R5 issue: GitHub Issue `#1175`;
- checkpoint and preparation run: `30831843111`;
- latest health-change diagnostic: `31032129918`;
- latest monthly egress breakdown: `31034105841`;
- latest source commit: `e1af37a9e7660c7125359b40786d90b493c8f8c5`;
- replan: [`ops/r5-egress-convergence-replan-2026-08-06.md`](ops/r5-egress-convergence-replan-2026-08-06.md);
- runtime invariants: [`history-runtime-contract.md`](history-runtime-contract.md);
- resource boundary: [`resource-envelope.md`](resource-envelope.md).

## Operating restrictions

- Do not automatically restart R5 when rolling headroom first becomes positive.
- Do not reduce the fixed 4 GiB rolling halt or 128 MiB reservation without a source-backed tighter bound and a new qualification decision.
- Do not describe conservative application accounting as exact provider egress.
- Do not skip ledgers, break parent-hash continuity, or replace historical recovery with latest-state-only collection.
- Do not rebase without fixed-ledger, manifest, relationship, identity, and continuation evidence.
- Do not restart the retired Cloudflare collector.
- Do not use GitHub Actions as the normal collection clock.
- Do not switch the public reader.
- Do not enable Mainnet.
- Do not start stabilization or soak before separate authorization.
- Do not advance state after partial persistence or silently fall back after an integrity failure.
