# History runtime contract

Status: P0 implementation contract. This document describes the current code paths and does not certify release readiness.

## Product invariant

XRPL Lending Monitor must preserve two truths without conflating them:

1. **current state** resolved from one verified immutable base plus contiguous post-base overlay changes; and
2. **historical evidence** for supported Lending transactions, normalized object changes, Loan lifecycle events, deleted final states, and asset-scoped debt, cover, and loss changes.

Only validated Devnet ledgers are in scope. Mainnet remains disabled.

## Runtime paths

| Path | Trigger | Canonical responsibility | Persistence | Public role |
|---|---|---|---|---|
| Five-minute Queue fast lane | One `*/5 * * * *` Worker cron, one Queue producer, one single-concurrency consumer | Resume at the ledger after the fast-lane cursor, reject index/hash discontinuity, catch up in bounded passes, derive current projection mutations, and retain the same-window semantic history bundle | `fast_lane_shadow_state`, `fast_lane_shadow_objects_compact`, `fast_lane_history_windows`, run metrics, Queue slots | Fresh current-state tail and immediate post-immutable-boundary history |
| Protected full collector | Real UTC `00:00`, `04:00`, `08:00`, `12:00`, `16:00`, and `20:00` scheduled slots only | Resume at canonical `sync_state + 1`; atomically persist full semantic history, current overlay, and canonical cursor | `processed_ledgers`, `protocol_events`, `object_changes`, `loan_lifecycle_events`, `archived_objects`, `balance_history`, `current_state_overlay_objects`, `sync_state` | Canonical D1 live history and overlay after the immutable publication boundary |
| Immutable history publication | Explicit bounded checkpoint/publication workflow | Convert a verified contiguous historical range into immutable segment-chain artifacts and exact indexes | GitHub-backed immutable history assets and channel/publication manifests | Long-lived history through the published boundary |
| Hybrid API merge | Public read request | Verify immutable history source, read immutable records through its boundary, read live D1 and fast-lane records after the boundary, deduplicate, order, and bound the response | Read-only | Activity, object history, Loan lifecycle, archive, cover/loss, exports, and feeds |
| Fast-lane promotion | After bounded catch-up reaches the observed head | Promote newer compact current projections into the canonical overlay only when base identity and source position are valid | `current_state_overlay_objects`, overlay state, sync state; then remove promoted compact rows | Keep current public state aligned with the five-minute cursor |

## Five-minute Queue behavior

Production is intentionally stopped while the subrequest correction is reviewed. The
configuration keeps cron empty; the behavior below is the contract for a separately
approved future recovery, not authorization to deploy or resume delivery.

1. Normalize each real cron time to one exact five-minute Queue slot.
2. Claim that slot by `scheduled_time`; ignore duplicate deliveries after a completed owner exists.
3. Check bounded storage capacity.
4. Run the protected full collector **once only when the real Queue slot itself is a four-hour UTC boundary**.
5. Run exactly one bounded fast-lane pass, capped at 32 contiguous ledgers. Later deliveries resume at the committed cursor plus one.
6. Each pass begins at the committed fast-lane cursor plus one and validates parent-hash continuity.
7. Build one history bundle from the exact scan. The bundle includes:
   - protocol events;
   - normalized object changes;
   - Loan lifecycle events;
   - deleted-object archives;
   - debt, cover, and loss history.
8. Encode the complete semantic bundle as versioned `gzip-base64-v1:` text before applying the 131,072-byte persistence guard.
9. Try the full configured contiguous ledger range first. Reduce only to the largest contiguous prefix when the **encoded** bundle exceeds the guard. Never remove a semantic history class to make a bundle fit.
10. If one ledger cannot fit after encoding, fail before cursor advancement. Do not commit and later delete evidence silently.
11. Atomically commit the fast-lane cursor, compact current mutations, encoded history bundle, and window evidence.
12. When caught up, promote compact current mutations to the canonical overlay.
13. Reserve the successor durably before publication by storing both its timestamp and cadence discriminator, then mark the Queue slot completed after publication. A publication retry must replay both staged values without recomputing them. While lag remains, use a synthetic one-minute successor; after lag reaches zero, return to the next normal five-minute boundary.
14. On failure, leave the cursor before the failed range and mark the slot error. Transient failures, including D1 connection loss, retry at the same slot with a five-minute delay and the Queue's configured retry cap. Caught subrequest-limit or capacity exhaustion is terminal for that delivery: acknowledge it without publishing a successor so rapid retry loops fail closed.

Readers must transparently decode `gzip-base64-v1:` rows and continue to read legacy plain-JSON rows during the rolling format transition. Catch-up passes are internal bounded work. Their synthetic timestamps must never create another protected full-collector invocation.

Synthetic catch-up messages carry the explicit `queue-catch-up` discriminator. The
scheduled entry rejects that discriminator for protected-heavy-cycle selection even if
the synthetic timestamp happens to equal a four-hour boundary. Only a normal Queue
slot can invoke the protected collector.

## Protected full-collector atomic boundary

For each committed validated range, one D1 batch contains:

- cursor and overlay precondition guards;
- processed ledger identity and parent-hash evidence;
- supported protocol events;
- normalized AffectedNodes field changes;
- Loan lifecycle events;
- deleted final-state archives;
- debt, cover, and loss history;
- current overlay upserts and tombstones;
- overlay watermark advancement;
- canonical sync cursor advancement;
- postcondition guards.

The cursor and overlay watermark advance only if the batch succeeds and the post-read confirms the exact final ledger index and hash.

## History class matrix

| History class | Five-minute bundle | Protected D1 collector | Immutable segments | Hybrid API |
|---|---:|---:|---:|---:|
| Validated ledger coverage | Window range and final hash | `processed_ledgers` | Segment ledger records | Status/audit evidence |
| Protocol events | Yes | Yes | Yes | Activity, exports, feed |
| Object before/after changes | Yes | Yes | Yes | Object history, transaction detail |
| Loan lifecycle | Yes | Yes | Yes | Loan lifecycle and lifecycle explorer |
| Deleted-object final state | Yes | Yes | Yes | Archived objects |
| Debt/Cover/Loss history | Yes | Yes | Yes | Cover & Loss |
| Current projection mutation | Compact overlay mutation | Canonical overlay mutation | Not current truth | Current entity APIs |

The five-minute bundle is immediate live-tail evidence. The protected D1 collector and immutable publication remain the canonical durable paths. Duplicate records must converge through their existing canonical identities and hybrid merge keys.

## Failure and reset behavior

- Never skip a failed ledger.
- Never advance either cursor after incomplete persistence.
- Never advance an overlay watermark beyond its cursor.
- Stop on parent-hash discontinuity or base/epoch mismatch.
- Serve only the last verified base plus last committed overlay, with truthful stale/unavailable state.
- A confirmed Devnet reset ends the current epoch; it must not reuse the prior epoch base.
- A reanchor, reset, base replacement, deployment, or production configuration change invalidates any active qualification window.

## Retention roles

`fast_lane_history_windows` is a bounded live-tail cache and recovery witness. Its ring retention is not, by itself, valid 24-hour certification evidence. The encoded-byte guard prevents oversized rows from advancing the cursor; retention must never delete a row merely because its payload is oversized. A formal qualification must retain an independent immutable audit artifact containing the accepted starting cursor, every committed range, final cursor/hash, semantic record counts and witnesses, configuration identities, and measured resource usage.

Queue slots are retained for seven days and run metrics retain several days, but neither substitutes for semantic-history evidence.

## Pre-soak gates

No new 24-hour soak may start until all of the following pass before the fixed boundary:

1. exactly one five-minute Worker cron and one Queue producer/single-concurrency consumer;
2. Devnet enabled and Mainnet disabled;
3. twelve consecutive exact five-minute Queue slots complete with no genuine errors;
4. fast-lane and canonical overlay ledger and hash agree at the final gate;
5. compact, stale, and foldable rows are zero;
6. no synthetic catch-up pass triggers the protected collector;
7. representative Devnet transactions cross-audit protocol event, object change, lifecycle/archive/balance records, and final current projection;
8. immutable boundary plus D1 plus fast-lane merge has no missing or conflicting canonical identity;
9. measured steady-state D1 reads, writes, storage, Queue work, Worker runtime, RPC usage, compression cost, and catch-up throughput satisfy Issue #963 limits;
10. the evidence collector is deployed and armed before the window and does not mutate or repeatedly charge production during the window.

## Formal 24-hour evidence

A passing final audit must prove all 288 real slots, the complete starting-to-ending ledger chain, zero missing supported semantic records, final current/history agreement, unchanged deployment/base/epoch/configuration identities, and Free-operation headroom. HTTP 200, terminal lag zero, or retained-window `gap_count = 0` alone cannot pass the product contract.
