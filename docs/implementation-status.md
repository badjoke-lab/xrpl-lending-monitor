# Implementation status

Last updated: 2026-07-06.

## Current phase

M1 incremental continuation is active. HYB-3 through HYB-6 are integrated into `main`, the guarded verified-base handover has completed, and production catch-up is advancing contiguously from ledger `3371676`. The remote Worker network-status path is healthy and observing Devnet through the standard-port primary endpoint. M1-HYB-7 live continuation verification and diagnostics are active. Live evidence has observed created-current, modified-current, deletion/archive/tombstone, ledger-continuity, and cursor/overlay-agreement paths; LoanPay, impairment, unimpairment, default, activity/lifecycle/balance consistency, and freshness remain incomplete. The production collector remains configured for a maximum of 40 ledgers per scheduled run with row, statement, overlay, transaction, RPC, and execution-time bounds.

Two live `ModifiedNode` metadata blockers have been reproduced from Devnet and fixed without weakening validation for known lending objects. M1 exit diagnostics now use the configured catch-up base identity as the authoritative expected base, independently compare it with the active D1 overlay binding, and have been verified live. Permanent read-only runtime monitoring samples collector progress, raw HYB-7 evidence counts and drilldown, HYB-7 path states, M1 exit evidence/gates, and handover replay state every 30 minutes. M5-5 and M6 remain gated behind M1 exit.

Dense-range live benchmarks showed that increasing D1 collector budgets can restore negative lag slope, but sustained dense historical catch-up would exceed the Free D1 write envelope. The active architecture therefore separates dense historical backfill into deterministic immutable history segments while preserving D1 for bounded live continuation. The segment manifest/continuity contract and collector-semantic record builder are integrated. A bounded fixed-range segment runner has passed a live deterministic replay rehearsal over Devnet ledgers `3389181` through `3389185`, producing byte-identical files and manifest across two independent generations.

## Verified base

The active Devnet base is fixed to ledger `3371675` and contains:

- 797,550 Vault records;
- 528,228 Loan Broker records;
- 226,725 Loan records;
- 1,552,503 total current-state records.

The exact base identity is:

- epoch: `devnet-3371675`;
- snapshot: `devnet-3371675-0ba2ed766c19`;
- ledger index: `3371675`;
- ledger hash: `0BA2ED766C190C733F8F26288785CBDF01D0FC26E1A6C03EDB7E9DFF6F8BCB90`.

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
- a read-only continuation diagnostics endpoint with aggregate evidence, path report, latest-ledger drilldown, and linkage-gap counts;
- a read-only M1 exit diagnostics endpoint with authoritative expected base identity, bound overlay base identity, processed range, cursor/head evidence, continuation evidence, and evaluated gates;
- authoritative M1 expected-base resolution from the same configured catch-up identity used by the guarded scheduled handover;
- healthy remote Devnet network-status refresh with the standard-port Devnet endpoint as primary and the Ripple non-standard-port endpoint retained as fallback;
- a read-only HYB-6 initialization status endpoint that resolves the active verified base identity and runs the exact handover planner in dry-run mode without D1 mutation;
- live normalization coverage for zero-omitted XRP Vault assets;
- live normalization coverage for bookkeeping `ModifiedNode` metadata with neither `PreviousFields` nor `FinalFields`;
- live normalization coverage for sparse non-lending bookkeeping `ModifiedNode` metadata such as `DirectoryNode` with `FinalFields` but no `PreviousFields`, while known Vault, LoanBroker, and Loan objects retain strict validation;
- bounded row and statement budgets raised to accommodate observed valid live Vault create/delete ranges while preserving the other run limits;
- remote throughput evidence proving 48 ledgers per run exceeds the current Worker invocation subrequest ceiling and fails closed before cursor advancement;
- remote recovery and post-recovery slope evidence proving the bounded 40-ledger configuration can advance successfully with zero sampled failures and negative lag slope in normal ranges;
- permanent read-only runtime monitoring that records collector cursor/head/lag movement, resource usage, failures, HYB-7 source/projection counts and path states, M1 exit evidence/gates, and handover replay state every 30 minutes and fails closed on collector errors or cursor stalls while lag remains positive;
- dense history segment architecture separating immutable historical artifacts from bounded D1 live continuation;
- history segment manifest validation with required file kinds, ledger range identity, SHA-256 digests, and previous-segment linkage;
- exact adjacent-segment index and parent-hash continuity checks;
- a pure history-segment record builder that reuses the existing AffectedNodes, lifecycle, archive, balance-history, and current-projection derivations;
- a bounded fixed-range segment runner with deterministic canonical JSON, deterministic gzip, SHA-256 file digests, and validated manifest output;
- live byte-identical replay evidence for Devnet ledgers `3389181` through `3389185`.

Mainnet remains disabled.

## Latest live evidence

The first live metadata blocker stopped the collector at cursor `3375749` with `PreviousFields must be an object`. A bounded probe of ledgers `3375750` through `3375789` found successful `VaultCreate` transactions containing bookkeeping `AccountRoot` `ModifiedNode` entries with neither `PreviousFields` nor `FinalFields`. The normalizer now treats that no-material-field-delta shape as a no-op while retaining strict one-sided validation for known lending object types.

A later blocker stopped at cursor `3375895` with the same surfaced error text. A second bounded probe of ledgers `3375896` through `3375935` found sparse non-lending bookkeeping nodes such as `DirectoryNode` with `FinalFields` but no `PreviousFields`. The collector now ignores only sparse non-lending bookkeeping `ModifiedNode` shapes outside the Vault / LoanBroker / Loan object-change model. Known lending objects remain fail-closed.

After deployment of the second fix, the collector resumed advancing with zero sampled failures and null error state. The M1 expected-base fix was then deployed and verified live. At verification time:

- expected base and bound base matched exactly;
- `verifiedBaseBinding` was `observed`;
- `catchUpStart` was `observed`;
- processed-ledger evidence began at `3371676`;
- processed-ledger discontinuities were `0`;
- `validatedHeadReached` remained `missing` because catch-up was still behind the observed head;
- `liveContinuation` remained incomplete because required HYB-7 paths were still missing or inconsistent.

A six-sample one-minute post-recovery slope benchmark then observed:

- cursor `3380320 -> 3380520` (`+200`);
- head `3410616 -> 3410716` (`+100`);
- lag `30296 -> 30196` (`-100`);
- six of six samples with zero failures and null errors;
- 40 ledgers processed on every sampled run;
- 48 estimated rows and 47 estimated statements on every sampled run;
- zero lending transactions in that sampled range.

This shows the earlier short positive-lag window was local to a dense range rather than evidence of sustained throughput failure. The current 40-ledger configuration therefore remains unchanged for the live Worker path.

At the end of the same benchmark, HYB-7 diagnostics had:

- processed ledgers: 8,845;
- range: `3371676 -> 3380520`;
- discontinuities: `0`;
- object changes: 71 created, 14 modified, 14 deleted;
- overlay matches: 57 created matches and 14 modified matches;
- protocol events: 105 total;
- LoanPay: 0;
- LoanManage: 0;
- lifecycle events: 0;
- balance-history rows: 0;
- archives: 14 with zero archive/tombstone disagreement.

The dense-range budget experiments later established that a 2048/2048 row/statement budget with 128 overlay mutations can process 40 ledgers per active run with strong negative lag slope, but the observed write volume is not suitable for sustained Free-plan D1 historical catch-up. The replacement history-segment rehearsal over ledgers `3389181 -> 3389185` generated twice and produced byte-identical output. The segment contained:

- 5 ledger records;
- 14 protocol events;
- 213 object changes;
- 14 current-projection mutations;
- 0 loan-lifecycle rows;
- 0 archived-object rows;
- 0 balance-history rows.

## HYB-7 verification semantics

The verifier exposes each required live path as `observed`, `missing`, or `inconsistent`.

- zero required evidence remains `missing` and never passes by default;
- contradictory source/projection evidence is `inconsistent`;
- the overall report passes only when every required path is `observed`;
- processed-ledger gaps or parent-hash discontinuities fail continuity verification;
- archive and tombstone evidence is checked in both directions;
- cursor and overlay watermark must agree;
- freshness passes only at healthy zero reported lag.

The verification and diagnostics endpoints are read-only. They do not create live evidence or infer success from the target schedule. Diagnostics expose aggregate counts, latest observed ledgers, and linkage-gap counts so absent source events can be distinguished from derivation or projection disagreement before any Devnet evidence generation is considered.

## Active unit

HYB-6 live continuation remains bounded at the 40-ledger maximum configuration, while dense historical catch-up is being moved out of the D1 row-by-row path. The guarded handover remains complete and replays as a no-op guard before scheduled collection. Permanent runtime monitoring continues to sample progress, HYB-7 diagnostics, and raw M1 exit evidence every 30 minutes.

The active implementation unit is deterministic history-segment generation, chain verification, bounded checkpoint/resume support, and rehearsal of adjacent segment linkage before any canonical dense backfill publication or replacement-base handover.

## Next order

1. Merge the fixed-range deterministic history-segment runner after CI and replay evidence review.
2. Add segment-chain verification across multiple adjacent manifests and fail closed on index or parent-hash discontinuity.
3. Add bounded checkpoint and resume state for fixed historical ranges.
4. Rehearse two adjacent non-canonical Devnet segments and require exact linkage plus deterministic replay.
5. Add publication metadata and bounded readers without changing existing public API semantics.
6. Backfill the dense historical gap into verified immutable segments.
7. Build and independently verify a replacement current-state base near the verified segment-chain end.
8. Execute guarded replacement-base handover and resume bounded D1 live continuation.
9. Re-evaluate HYB-7 diagnostics at the validated head and resolve only genuinely missing paths.
10. Complete M1 exit review and reconciliation, then M5-5 and M6 hardening.

## Remaining blockers

- The production cursor has not yet reached the validated head.
- Dense historical catch-up is not yet covered by a verified published segment chain.
- Checkpoint/resume and multi-segment rehearsal are not yet complete.
- Real HYB-7 live-path evidence is incomplete for LoanPay, impairment, unimpairment, default, activity/lifecycle/balance consistency, and freshness.
- M1 exit remains incomplete until validated-head reach and all required live continuation paths are observed and consistent.
- M5-5 and M6 remain incomplete.
