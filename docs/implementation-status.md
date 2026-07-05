# Implementation status

Last updated: 2026-07-05.

## Current phase

M1 incremental continuation is active. HYB-3 through HYB-6 are integrated into `main`. M1-HYB-7 live continuation verification tooling is implemented on the active branch, but real live-path evidence has not yet been collected. Production catch-up has not started. M5-5 and M6 remain gated behind M1 exit.

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
- scheduled-path gating behind an explicit catch-up initialization flag that defaults to disabled;
- read-only live continuation verification for created and modified current objects, Loan payments, impairment, unimpairment, default, deletion/archive consistency, activity/lifecycle/balance evidence, ledger continuity, cursor/overlay agreement, and freshness.

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

The remote Devnet deployment path and read-only D1 inspection path are verified. Worker network-status refresh is being hardened for the non-standard-port Devnet RPC path by serializing the snapshot RPC sequence and preserving the underlying socket failure message. Production catch-up remains blocked until a post-deploy run records a successful network snapshot.

## Next order

1. Deploy the serialized Devnet network-snapshot RPC fix and verify a successful remote status refresh.
2. Inspect remote Devnet state and run the guarded handover dry-run.
3. Execute the guarded handover only if remote evidence matches the initialization contract.
4. Start bounded catch-up from ledger `3371676`.
5. Collect and verify real created, modified, payment, state-transition, deletion, archive, balance-history, continuity, and freshness evidence.
6. Complete M1 exit review.
7. Complete M5-5, then begin M6 hardening and multi-day Devnet soak.

## Remaining blockers

- Post-deploy successful Worker network-status refresh evidence is not yet recorded.
- Production catch-up has not started.
- Real HYB-7 live-path evidence is not yet complete.
- M1 exit reconciliation evidence is incomplete.
- M5-5 and M6 remain incomplete.
