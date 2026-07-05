# Implementation status

Last updated: 2026-07-05.

## Current phase

M1 incremental continuation is active. HYB-3 through HYB-6 are integrated into `main`, the guarded verified-base handover has completed, and production catch-up is advancing contiguously from ledger `3371676`. The remote Worker network-status path is healthy and observing Devnet through the standard-port primary endpoint. M1-HYB-7 live continuation verification and diagnostics are active. Live evidence has now observed created-current, modified-current, deletion/archive/tombstone, ledger-continuity, and cursor/overlay-agreement paths; LoanPay, impairment, unimpairment, default, activity/lifecycle/balance consistency, and freshness remain incomplete. The production collector remains configured for a maximum of 40 ledgers per scheduled run with row, statement, overlay, transaction, RPC, and execution-time bounds. A live no-field `ModifiedNode` metadata blocker was reproduced from Devnet, fixed with fail-closed one-sided validation preserved, deployed, and verified by cursor recovery with zero sampled failures. Permanent read-only runtime monitoring now samples collector progress, raw HYB-7 evidence counts, HYB-7 path states, M1 exit evidence/gates, and handover replay state every 30 minutes. M5-5 and M6 remain gated behind M1 exit.

## Verified base

The active Devnet base is fixed to ledger `3371675` and contains:

- 797,550 Vault records;
- 528,228 Loan Broker records;
- 226,725 Loan records;
- 1,552,503 total current-state records.

## Completed continuation path

The implemented path now includes:

- verified immutable base read model publication;
- bounded D1 incremental history and current overlay;
- atomic history, overlay, watermark, and cursor advancement;
- base-plus-overlay current API resolution;
- bounded scheduled collection with deadline and work limits;
- retry and fallback request accounting;
- collector cursor, lag, freshness, and run-usage status;
- rehearsal evidence for interruption, resume, replay, and rejected gaps;
- cursor and overlay watermark checkpoint agreement;
- base-count plus create/delete delta reconciliation;
- relationship reconciliation issue propagation;
- deleted-object current exclusion and archive-presence checks;
- guarded one-time handover planning from the observation epoch to the verified base epoch;
- dry-run inspection, exact replay/no-op handling, and progressed-state no-op handling;
- pre/post sync, overlay, history, and epoch guards around the handover batch;
- fail-closed rejection for reset suspicion, unavailable network state, existing conflicting cursor/history/overlay state, and epoch mismatch;
- scheduled-path gating behind an explicit catch-up initialization flag;
- successful guarded handover from the observation epoch to verified base epoch `devnet-3371675`;
- contiguous production catch-up beginning at ledger `3371676`;
- live remote evidence for created and modified current objects, deletion/archive/tombstone consistency, ledger continuity, and cursor/overlay watermark agreement;
- read-only live continuation verification for created and modified current objects, Loan payments, impairment, unimpairment, default, deletion/archive consistency, activity/lifecycle/balance evidence, ledger continuity, cursor/overlay agreement, and freshness;
- a read-only continuation diagnostics endpoint that returns the exact aggregate source/projection evidence snapshot together with the HYB-7 path report derived from that snapshot;
- a read-only M1 exit diagnostics endpoint that returns expected/bound base identity, processed range, cursor/head evidence, continuation evidence, and the evaluated M1 exit report from one evidence snapshot;
- healthy remote Devnet network-status refresh with the standard-port Devnet endpoint as primary and the Ripple non-standard-port endpoint retained as fallback;
- a read-only HYB-6 initialization status endpoint that resolves the active verified base identity and runs the exact handover planner in dry-run mode without D1 mutation;
- live normalization coverage for zero-omitted XRP Vault assets;
- live normalization coverage for bookkeeping `ModifiedNode` metadata with neither `PreviousFields` nor `FinalFields`, treated as a no-op while one-sided malformed field payloads still fail closed;
- bounded row and statement budgets raised to accommodate observed valid live Vault create/delete ranges while preserving the other run limits;
- remote throughput benchmark evidence proving that a 48-ledger scheduled range exceeds the current Worker invocation subrequest ceiling and fails closed before cursor advancement;
- remote recovery benchmark evidence proving that the bounded 40-ledger configuration can process successful catch-up ranges with zero sampled failures;
- permanent read-only runtime monitoring that records collector cursor/head/lag movement, resource usage, failures, HYB-7 source/projection counts and path states, M1 exit evidence/gates, and handover replay state every 30 minutes and fails closed on collector errors or cursor stalls while lag remains positive.

Mainnet remains disabled.

## Latest live recovery evidence

The no-field `ModifiedNode` blocker stopped the collector at cursor `3375749` with repeated `PreviousFields must be an object` failures. A bounded live probe of ledgers `3375750` through `3375789` found successful `VaultCreate` transactions containing bookkeeping `AccountRoot` `ModifiedNode` entries with neither `PreviousFields` nor `FinalFields`. The normalizer now ignores only that exact no-material-field-delta shape and retains strict validation when only one field payload side is present.

After deployment, the collector recovered and advanced from the blocked range with zero sampled failures and null error state. A subsequent diagnostic monitor reached cursor `3375846`, processed-ledger count `4171`, and zero continuity discontinuities. The same evidence snapshot observed 26 created changes, 3 modified changes, 11 deleted changes, 15 overlay upserts, 11 tombstones, and 3 matching modified projections. `modifiedCurrent` therefore moved from `missing` to `observed`.

The short post-recovery monitor window advanced the cursor by 26 ledgers while the observed head advanced by 39, so lag increased by 13 in that local heavy range. This is not treated as sustained regression evidence by itself. Longer monitor windows remain the source of truth for catch-up slope decisions; the current task is continued bounded catch-up with immediate investigation of any new collector error or cursor stall.

## HYB-7 verification semantics

The verifier exposes each required live path as `observed`, `missing`, or `inconsistent`.

- zero evidence remains `missing` and never passes by default;
- contradictory current/history evidence is `inconsistent`;
- the overall report passes only when every required path is `observed`;
- processed-ledger gaps or parent-hash discontinuities fail continuity verification;
- archive and tombstone evidence is checked in both directions;
- cursor and overlay watermark must agree;
- freshness passes only at healthy zero reported lag.

The verification and diagnostics endpoints are read-only. They do not create live evidence or infer success from the target schedule. Diagnostics expose aggregate evidence counts so missing source events can be distinguished from source/projection or activity/lifecycle/balance disagreement before any Devnet evidence generation is considered.

## Active unit

HYB-6 production catch-up is running at the bounded 40-ledger maximum configuration. The guarded handover remains complete and replays as a no-op guard before scheduled collection. The no-field metadata blocker has been fixed and live recovery verified. Permanent runtime monitoring now samples progress, HYB-7 diagnostic evidence, and raw M1 exit evidence every 30 minutes. The active unit is sustained catch-up observation, HYB-7 source/projection evidence accumulation, immediate repair of any newly observed live blocker, and preparation to resolve only the paths that remain genuinely missing or inconsistent at the validated head.

## Next order

1. Keep the bounded 40-ledger maximum configuration active and continue contiguous catch-up.
2. Use the permanent runtime monitor to record cursor/head/lag slope and fail immediately on collector errors or cursor stalls while lag remains positive.
3. Compare HYB-7 source/projection diagnostic counts during catch-up and distinguish absent source events from derivation or projection disagreement.
4. Continue catch-up until the cursor reaches the validated head without gap or parent-hash discontinuity.
5. Re-evaluate HYB-7 diagnostics at the head and collect or generate only the minimum canonical Devnet evidence required for paths that remain genuinely missing.
6. Resolve LoanPay, impairment, unimpairment, default, and activity/lifecycle/balance consistency before M1 exit.
7. Complete M1 exit review and reconciliation using the raw M1 exit diagnostics evidence.
8. Complete M5-5, then begin M6 hardening and multi-day Devnet soak.

## Remaining blockers

- The production cursor has not yet reached the validated head.
- Real HYB-7 live-path evidence is incomplete for LoanPay, impairment, unimpairment, default, activity/lifecycle/balance consistency, and freshness.
- Sustained post-recovery lag slope still requires longer monitor evidence because the first heavy post-recovery window advanced the cursor but temporarily increased lag.
- M1 exit reconciliation evidence is incomplete.
- M5-5 and M6 remain incomplete.
