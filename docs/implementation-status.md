# Implementation status

Last updated: `2026-07-24T09:15Z`.

## Current phase

XRPL Lending Monitor remains in P0 recovery on XRPL Devnet.

The product has not passed a complete-history release qualification. Mainnet remains disabled.

The implementation-level division of responsibility is defined in [`history-runtime-contract.md`](history-runtime-contract.md).

## Active production architecture

- Architecture: `rolling_checkpoint_fast_lane_v1`
- Network: `devnet`
- Mainnet enabled: `false`
- Public Worker: `https://xrpl-lending-monitor.badjoke-lab.workers.dev`
- Production cron: one `*/5 * * * *` schedule
- Protected canonical-overlay collector cadence: four hours
- Current-state source: five-minute `fast_lane`
- Immutable history mode: `hybrid`

## Verified claims

The five-minute fast lane resumes from the ledger immediately after its committed cursor, rejects parent-hash discontinuity, records Lending protocol activity and semantic history, derives current-state overlay mutations, and promotes those mutations to the canonical overlay after bounded catch-up.

The protected full collector writes processed-ledger evidence, protocol events, object changes, Loan lifecycle, archives, balance history, canonical overlay mutations, and cursor advancement inside its canonical D1 commit boundary.

The fast-lane Queue evaluates the protected four-hour cadence from the real Queue slot only. Synthetic bounded catch-up passes may not trigger an additional protected collector cycle.

The 2026-07-24 post-deploy production probe verified that newly written five-minute bundles contained protocol events, object changes, Loan lifecycle, and balance history with valid schema, zero retained-window gaps, and a matching public object-history transaction witness.

## Current production blocker

The same post-deploy probe showed that uncompressed semantic bundles could not sustain the five-minute tail:

- 16 windows advanced only 88 ledgers;
- the largest retained bundle was 130,399 bytes against the 131,072-byte guard;
- fast-lane lag ended at 169 ledgers;
- compact rows ended at 183;
- canonical overlay remained behind the fast-lane cursor until catch-up.

This proves semantic persistence and public visibility, but it does not prove sustainable throughput or release readiness.

PR #991 introduces versioned gzip encoding while preserving every semantic history class, the contiguous-prefix rule, the encoded-byte guard, atomic cursor persistence, and legacy plain-JSON reads. That change is not production-qualified until full CI, guarded deployment, post-deploy catch-up, semantic API, runtime, D1, and storage evidence pass.

## Unverified release-critical claims

A new formal soak must not begin until an evidence design can prove all of the following for the fixed qualification window:

1. exact five-minute queue-slot continuity;
2. complete contiguous validated-ledger coverage from the accepted starting cursor;
3. no reanchor, reset, skipped ledger, or retention loss within the evidence window;
4. protocol-event completeness for every supported Lending transaction;
5. object-change, Loan lifecycle, deleted-object archive, and debt/cover/loss history completeness through both the fast-lane live tail and protected full-history path;
6. agreement between the final historical state and the public current-state projection;
7. stable network, epoch, base snapshot, deployment, and production configuration identities;
8. public API availability and semantic correctness, not HTTP status alone;
9. Worker, Queue, RPC, compression, D1 read/write, storage, overlay, retention, and catch-up use within the documented Free-operation envelope;
10. immutable retained evidence sufficient for an independent final audit.

The ad-hoc complete-history soak issues #983 and #984 were invalidated because their workflows could not prove this contract. They are not release evidence.

## Operating restrictions

- Do not enable Mainnet.
- Do not add another production collector cron.
- Do not shorten the five-minute cadence.
- Do not describe the product as healthy, release ready, pre-soak ready, stably operating, or complete-history qualified.
- Do not equate fast-lane ledger coverage with complete semantic history.
- Do not remove semantic history classes to restore throughput.
- Do not start another timed soak until the qualification contract and retention strategy are implemented and reviewed against the repository source of truth.
- Do not abandon, shrink, or remove the history product scope without an explicit owner decision.
- Preserve free-tier safety margins and fail closed on continuity, identity, encoded semantic-bundle size, or persistence errors.

## Next action

1. Complete CI for PR #991.
2. Deploy the compressed bundle reader/writer through a guarded Devnet-only path.
3. Verify that new rows use the versioned compressed format, remain publicly readable, and restore fast-lane/canonical lag and compact rows to zero without semantic loss.
4. Measure compression runtime and steady-state D1/Worker/Queue use against Issue #963.
5. Run the collector-only twelve-slot qualification required by Issues #963 and #973 only after the production repair passes.
6. Repair the qualification retention design so a full 24-hour window remains independently auditable outside the bounded live-tail ring.
7. Start a new fixed 24-hour soak only after the evidence system is already deployed and armed before the boundary.
