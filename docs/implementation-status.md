# Implementation status

Last updated: 2026-07-05.

## Current phase

M1 incremental continuation is active. HYB-3 through HYB-6 are integrated into `main`, the guarded verified-base handover has completed, and production catch-up is advancing contiguously from ledger `3371676`. The remote Worker network-status path is healthy and observing Devnet through the standard-port primary endpoint. M1-HYB-7 live continuation verification tooling is active and has already observed created-current, deletion/archive/tombstone, ledger-continuity, and cursor/overlay-agreement paths; other live paths remain incomplete. The active operational unit is bounded catch-up throughput tuning so the collector can reduce rather than accumulate lag while remaining inside Worker, D1, RPC, row, statement, and execution-time guardrails. A 48-ledger live benchmark exceeded the Worker invocation subrequest ceiling and was rejected without cursor advancement. The next calibration point is 40 ledgers per run with all other safety bounds preserved. M5-5 and M6 remain gated behind M1 exit.

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
- live remote evidence for created current objects, deletion/archive/tombstone consistency, ledger continuity, and cursor/overlay watermark agreement;
- read-only live continuation verification for created and modified current objects, Loan payments, impairment, unimpairment, default, deletion/archive consistency, activity/lifecycle/balance evidence, ledger continuity, cursor/overlay agreement, and freshness;
- healthy remote Devnet network-status refresh with the standard-port Devnet endpoint as primary and the Ripple non-standard-port endpoint retained as fallback;
- a read-only HYB-6 initialization status endpoint that resolves the active verified base identity and runs the exact handover planner in dry-run mode without D1 mutation;
- live normalization coverage for zero-omitted XRP Vault assets;
- bounded row and statement budgets raised to accommodate observed valid live Vault create/delete ranges while preserving the other run limits;
- remote throughput benchmark evidence proving that a 48-ledger scheduled range exceeds the current Worker invocation subrequest ceiling and fails closed before cursor advancement.

Mainnet remains disabled.

## HYB-7 verification semantics

The verifier exposes each required live path as `observed`, `missing`, or `inconsistent`.

- zero evidence remains `missing` and never passes by default;
- contradictory current/history evidence is `inconsistent`;
- the overall report passes only when every required path is `observed`;
- processed-ledger gaps or parent-hash discontinuities fail continuity verification;
- archive and tombstone evidence is checked in both directions;
- cursor and overlay watermark must agree;
- freshness passes only at healthy zero reported lag.

The verification endpoint is read-only. It does not create live evidence or infer success from the target schedule.

## Active unit

HYB-6 production catch-up is running, but the temporary 48-ledger calibration is not viable under the current Worker invocation subrequest ceiling. The guarded handover remains complete and replays as a no-op guard before scheduled collection. The active unit is remote throughput calibration at 40 ledgers per run: restore successful collection, measure cursor/head/lag slope over multiple scheduled cycles, and keep only a configuration that demonstrably reduces lag without violating subrequest, row, statement, overlay, transaction, RPC, or execution-time limits.

## Next order

1. Deploy the bounded 40-ledger catch-up configuration and verify that scheduled runs recover from the 48-ledger subrequest failure.
2. Measure cursor advance, validated-head advance, lag slope, run duration, RPC usage, row/statement usage, and failures over multiple scheduled cycles.
3. Keep, reduce, or further tune the bounded throughput configuration based on measured live evidence rather than nominal limits.
4. Continue contiguous catch-up until the cursor reaches the validated head without gap or parent-hash discontinuity.
5. Collect and verify the remaining real modified-current, LoanPay, impairment, unimpairment, default, activity/lifecycle/balance, and freshness paths.
6. Complete M1 exit review and reconciliation.
7. Complete M5-5, then begin M6 hardening and multi-day Devnet soak.

## Remaining blockers

- The 40-ledger configuration still requires live evidence proving successful recovery and sustained negative lag slope.
- The production cursor has not yet reached the validated head.
- Real HYB-7 live-path evidence is incomplete for modified current objects, LoanPay, impairment, unimpairment, default, activity/lifecycle/balance consistency, and freshness.
- M1 exit reconciliation evidence is incomplete.
- M5-5 and M6 remain incomplete.
