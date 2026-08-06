# R5 monthly egress convergence replan

Date: `2026-08-06`.

## Purpose

This document records the next engineering decision after the selected Supabase revision-3 R5 recovery halted on its application-owned rolling 31-day egress guard.

It does not weaken or reinterpret the selected profile. Revision 3 behaved correctly by halting before mutation. The unresolved question is different: whether the current recovery shape can ever close a moving Devnet lag while the fixed free-tier guard remains in force.

## Controlling boundary

Issue `#1175` selected and authorized the exact recovery identity:

- profile: `supabase_free_postgres_pgcron_edge`;
- revision: `3`;
- profile identity digest: `3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67`;
- R4E selection digest: `13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667`;
- network: `devnet`;
- recovery run: `r5-recovery-selected-revision3-entry`.

Public-reader cutover, Mainnet, stabilization, soak, and restart of the retired Cloudflare collector remain prohibited.

## Latest retained read-only state

Run `31032129918` observed:

- recovery status: `halted`;
- last error: `r5_recovery_monthly_egress_halt`;
- completed batches: `297`;
- committed ledgers: `5,811`;
- recovery watermark: `4,139,118`;
- physical watermark: `4,139,122`;
- active batches: `0`;
- noncommitted work: `0`;
- recent batch errors: none;
- database bytes: `276,958,355`;
- public reader unchanged: `true`;
- Mainnet disabled: `true`;
- stabilization authorized: `false`;
- soak authorized: `false`.

The halt therefore preserved a clean committed boundary. It is not evidence of skipped ledgers, partial persistence, or a failed rollback.

## Exact guard calculation

Read-only diagnostic run `31034105841` retained the following application-owned conservative accounting:

| Value | Bytes |
| --- | ---: |
| Attempt conservative bytes | 1,286,596,364 |
| R5 recovery conservative bytes | 2,880,972,004 |
| Prior conservative bytes | 4,167,568,368 |
| One new reservation | 134,217,728 |
| Projected conservative bytes | 4,301,786,096 |
| Fixed rolling halt | 4,294,967,296 |
| Headroom after reservation | -6,818,800 |

The next claim was correctly denied before mutation.

The first release time calculated from retained contributions, assuming no new contributions, is `2026-09-03T10:46:04.042Z`. This is only the first time one new 128 MiB reservation would fit. It is not an R5 completion date and does not authorize an automatic restart.

These figures are conservative application accounting. They must not be described as exact provider-reported egress usage.

## Convergence signal

The retained completed-recovery sample gives:

- `2,880,972,004 / 5,811 = 495,779.04` conservative bytes per committed ledger on average;
- the last retained live lag observation before the halt was `93,539` ledgers;
- applying the observed average to that lag yields approximately `46,374,675,664` bytes, or `43.19 GiB`;
- that is approximately `10.80` times the fixed 4 GiB rolling halt.

This is a planning signal, not a forward upper bound. Ledger contents vary, the validated head continues to move, and the sample includes the current recovery implementation's request and payload shape. It is nevertheless sufficient to reject the assumption that waiting for one rolling-window release automatically makes the existing recovery convergent.

## Current disposition

- Revision 3 remains the selected fail-closed profile.
- The current R5 recovery remains safely halted.
- The current recovery shape is **not yet qualified as convergent** under the fixed rolling egress guard.
- `2026-09-03T10:46:04.042Z` is a reservation-eligibility estimate only.
- No further recovery mutation is authorized merely because rolling headroom becomes positive.

## Required engineering sequence

### R5C1 — Status and resource reconciliation

Record the selected profile, active R5 state, exact halt calculation, and convergence blocker in the source-of-truth documents.

Exit condition: `implementation-status.md`, `resource-envelope.md`, this plan, and Issue `#1175` describe the same active state and restrictions.

### R5C2 — Read-only byte attribution

Using retained artifacts first, separate conservative bytes by:

- XRPL response class;
- scan request;
- transaction and metadata payload;
- emitted phase payload;
- retry or failed attempt reservation;
- database request/response where included by the application contract;
- fixed reservation slack.

Do not create new production recovery work for measurement. Any new diagnostic must remain read-only and must not consume a recovery reservation unless separately authorized.

Exit condition: every material contribution has a source-backed count and byte formula, and the sum reconciles with retained attempt and recovery totals.

### R5C3 — Candidate evaluation

Evaluate, without weakening integrity guarantees:

1. remove duplicate or unnecessary source reads;
2. avoid refetching data already proved by the active committed state;
3. reduce emitted payload only where exact reconstruction and digest parity remain provable;
4. evaluate a new verified base/checkpoint only as an explicit rebase operation with full relationship and continuity reconciliation;
5. determine whether a changed accounting or execution contract requires profile revision 4 and a full R4 qualification cycle.

Splitting the same total bytes across more runs is not a solution. Lowering the 4 GiB halt or 128 MiB reservation without a source-backed tighter bound is prohibited.

Exit condition: at least one candidate has a conservative end-to-end byte upper bound and a moving-head convergence calculation.

### R5C4 — Selection decision

Continue revision 3 only if evidence proves all of the following:

- fixed guards remain unchanged or become stricter;
- the chosen recovery path closes backlog faster than Devnet creates new backlog;
- total conservative bytes fit the rolling-window release schedule with intervention headroom;
- no public-reader, Mainnet, stabilization, or soak boundary changes;
- checkpoint, identity, continuity, committed-only visibility, retry, rollback, and duplicate convergence remain intact.

Otherwise define revision 4 as a new profile identity and rerun G1-G10 before any recovery mutation.

### R5C5 — One bounded proof burst

After an explicit selection decision, run one bounded recovery proof unit. Reconcile:

- exact start and end watermarks;
- validated head and lag slope;
- requests and conservative bytes;
- committed ledgers per byte;
- scan, commit, finalize, and successor state;
- failed/deferred attempts;
- rolling headroom;
- no skipped or duplicated ledger;
- public reader unchanged and Mainnet disabled.

Only then authorize continued recovery toward lag zero.

## R5 exit remains unchanged

R5 completes only after:

1. Devnet lag reaches zero;
2. no skipped or duplicated ledger is proved;
3. parent-hash continuity is proved;
4. committed-only visibility is proved;
5. retry, rollback, lease, interruption, and duplicate replay converge;
6. quota accounting reconciles;
7. no active or noncommitted recovery work remains;
8. a terminal read-only recovery record is retained;
9. a separate stabilization decision is prepared.

## Restrictions

- Do not automatically restart on the first rolling-window release time.
- Do not reduce fixed resource guards to make a burst pass.
- Do not call unavailable provider counters measured.
- Do not treat the observed average as a formal worst-case bound.
- Do not skip old ledgers or replace continuity with a latest-state-only shortcut.
- Do not rebase without a fixed validated ledger, manifest, identity, relationship, and continuation proof.
- Do not switch the public reader, enable Mainnet, start stabilization, or start soak during this replan.
