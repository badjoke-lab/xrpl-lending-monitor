# Implementation status

Last updated: `2026-07-24T11:24Z`.

## Current phase

XRPL Lending Monitor remains in P0 complete-history qualification on XRPL Devnet.

The production runtime is operating with the repaired compressed five-minute semantic-history path, but the product has not passed the twelve-slot pre-soak qualification or the final 24-hour complete-history release soak. Mainnet remains disabled.

The implementation-level division of responsibility is defined in [`history-runtime-contract.md`](history-runtime-contract.md).

## Active production architecture

- Architecture: `rolling_checkpoint_fast_lane_v1`
- Network: `devnet`
- Mainnet enabled: `false`
- Public Worker: `https://xrpl-lending-monitor.badjoke-lab.workers.dev`
- Production cron: one `*/5 * * * *` schedule
- Queue topology: one producer, one consumer, batch size 1, concurrency 1
- Protected canonical-overlay collector cadence: real four-hour UTC boundaries only
- Current-state source: five-minute `fast_lane`
- Immutable history mode: `hybrid`
- Five-minute semantic bundle encoding: `gzip-base64-v1`
- Encoded bundle guard: 131,072 bytes

## Product invariant

The full product scope remains unchanged:

1. verified current state from immutable base plus contiguous post-base overlay changes; and
2. complete historical evidence for supported Lending protocol events, normalized object changes, Loan lifecycle, deleted final states, and debt/cover/loss balance changes.

A throughput or qualification failure authorizes repair and rerun. It does not authorize removal of a semantic class, conversion to current-state-only monitoring, scope reduction, or project termination without an explicit owner decision.

## Verified production claims

The five-minute fast lane resumes from the ledger immediately after its committed cursor, rejects parent-hash discontinuity, records Lending protocol activity and all semantic history classes, derives current-state overlay mutations, and promotes those mutations to the canonical overlay after bounded catch-up.

The protected full collector writes processed-ledger evidence, protocol events, object changes, Loan lifecycle, archives, balance history, canonical overlay mutations, and cursor advancement inside its canonical D1 commit boundary.

The fast-lane Queue evaluates the protected four-hour cadence from the real Queue slot only. Synthetic bounded catch-up passes may not trigger an additional protected collector cycle.

The retained compressed-runtime production proof at `2026-07-24T10:30:50Z` passed:

- 12 compressed rows and 12 decoded rows;
- every row contained arrays for protocol events, object changes, Loan lifecycle, deleted archives, and balance history;
- maximum encoded bundle size 40,675 bytes;
- fast-lane and canonical overlay aligned at ledger 3,906,900 with matching hash;
- terminal lag 0;
- compact rows 0 and stale rows 0;
- representative public object-history transaction witness matched;
- Overview, history-source, fast-lane-diff, and replacement-base-rebase returned HTTP 200.

This bounded proof demonstrates that the compressed complete-semantic path is running. It is not, by itself, a twelve-slot qualification or 24-hour release certification.

## Corrected blocker status

The former uncompressed throughput blocker is repaired in production by PR #991 and the guarded Devnet deployment path in PR #992. The old description of 169-ledger lag and 183 compact rows was pre-repair evidence and no longer describes the latest measured runtime.

Remaining release blockers are evidence and qualification blockers:

1. prove twelve fixed consecutive real five-minute Queue slots with exact slot, metric, ledger/hash, semantic, identity, API, and resource evidence;
2. retain semantic evidence independently of the bounded live-tail ring for a complete 24-hour audit;
3. record and freeze the actual deployed Cloudflare Worker deployment identity;
4. reconcile the stale permanent watchdog and restore current continuous production evidence;
5. run the final 288-slot complete-history soak only after all pre-soak gates pass;
6. complete representative production browser and UI behavior verification before release.

## Active bounded qualification

Issue #995 controls the next gate.

- Fixed start: `2026-07-24T11:25:00Z` (`2026-07-24 20:25 JST`)
- Fixed final slot: `2026-07-24T12:20:00Z` (`2026-07-24 21:20 JST`)
- Expected slots: 12
- Evaluation: after `2026-07-24T12:25:30Z`
- Workflow: `.github/workflows/complete-history-12-slot-qualification-995.yml`
- Production mutation: none; the qualification reads D1, public APIs, XRPL Devnet, and Cloudflare deployment/configuration evidence after the window closes

The qualification must fail closed. Any failed gate invalidates the entire window. Evidence is preserved, the exact defect is repaired without weakening scope or cadence, and a new fixed twelve-slot window starts from zero.

## Unverified release-critical claims

A final release still requires proof of all of the following:

1. exact five-minute queue-slot continuity;
2. complete contiguous validated-ledger coverage from the accepted starting cursor;
3. no reanchor, reset, skipped ledger, conflicting overlap, or retention loss;
4. protocol-event completeness for every supported Lending transaction;
5. object-change, Loan lifecycle, deleted-object archive, and debt/cover/loss history completeness through the fast-lane and protected paths;
6. agreement between final historical state and public current-state projection;
7. stable network, epoch, base snapshot, immutable publication, deployed Worker, Queue, cron, and binding identities;
8. public API semantic correctness, not HTTP status alone;
9. Worker, Queue, RPC, compression, D1 read/write, storage, overlay, retention, and catch-up use inside the Free-operation envelope;
10. immutable retained evidence sufficient for independent final audit;
11. all 288 real slots and the complete starting-to-ending ledger chain in the final 24-hour soak.

## Operating restrictions

- Do not enable Mainnet.
- Do not add another production collector cron.
- Do not shorten the five-minute cadence before the five-minute qualification and soak pass.
- Do not call the product release-ready or complete-history qualified before the required evidence passes.
- Do not equate lag zero, HTTP 200, or live-tail ledger coverage alone with complete semantic history.
- Do not remove semantic history classes to restore throughput.
- Do not skip a failed ledger or advance a cursor after incomplete persistence.
- Do not start a 24-hour soak until its evidence system is deployed and armed before the fixed boundary.
- Do not abandon, shrink, or remove the history product scope without an explicit owner decision.
- Preserve Free-tier safety margins and fail closed on continuity, identity, bundle-size, or persistence errors.

## Next action

1. Complete the fixed Issue #995 twelve-slot read-only qualification.
2. Preserve the resulting machine-readable evidence and exact pass/fail reasons.
3. On failure, repair the specific defect and restart a fresh fixed twelve-slot window without reducing scope.
4. On pass, deploy and verify independent 24-hour semantic evidence retention.
5. Arm a new fixed 288-slot complete-history soak before its start boundary.
6. Run the final audit and proceed to release hardening only after it passes.
