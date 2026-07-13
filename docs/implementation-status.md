# Implementation status

Last updated: `2026-07-13T09:27Z`.

## Current phase

XRPL Lending Monitor is in P0 recovery on XRPL Devnet.

The earlier `Pre-soak ready` state is revoked. Newer retained production evidence showed that the five-minute current-state tail could remain recent while other public data paths were not reliable enough for a release claim.

Mainnet remains disabled.

## Active production architecture

- Architecture: `rolling_checkpoint_fast_lane_v1`
- Network: `devnet`
- Mainnet enabled: `false`
- Public Worker: `https://xrpl-lending-monitor.badjoke-lab.workers.dev`
- Production cron: one `*/5 * * * *` schedule
- Protected canonical-overlay collector cadence: four hours
- Current-state source: five-minute `fast_lane`
- Immutable history mode: `hybrid`

## Active production checkpoint

- Epoch: `devnet-3371675`
- Snapshot: `devnet-3592674-0373cda0b0cd`
- Ledger: `3,592,674`
- Ledger hash: `0373CDA0B0CD8486C0C55C5B5DD460501419367BD76D146E4A718EBD9DD8A893`

The checkpoint identity remains fixed. The current blockers concern public availability, sustained history advancement, freshness classification, and health-gate correctness.

## P0 findings

1. A transient current-state release-source read failure could remove the verified snapshot from public current-state responses.
2. The protected history/current-overlay path was far behind the validated head and did not demonstrate sustainable catch-up.
3. The fast-lane differential could pass when all sampled canonical comparison rows were missing.
4. A recent successful protected-collector run did not prove acceptable history freshness.

Issue #463 is the controlling recovery issue.

## P0 recovery order

### Current-state availability

- retain the last verified release reader within the active Worker isolate;
- refresh it periodically instead of reopening the release channel on every public request;
- allow fallback only for the same repository, branch, and configured replacement snapshot identity;
- fail closed when no verified reader exists or the configured identity changes;
- verify the behavior with injected source failures.

### Truthful comparison and readiness

- reject empty samples;
- reject samples with no canonical comparison population;
- require at least one exact source-position comparison;
- require zero exact projection mismatches;
- do not use a successful soak process as a substitute for product-data health.

### Sustainable history freshness

- replace or redesign the history tail so measured daily advancement exceeds observed ledger production;
- preserve atomic cursor, history, lifecycle, archive, balance, current-overlay, and tombstone persistence;
- preserve idempotency, gap rejection, epoch/base binding, reconciliation, and free-tier resource limits;
- do not increase limits or cadence without measurement.

## Previous evidence status

Prior runtime, source-comparison, browser, and free-tier measurements remain historical engineering evidence. They no longer establish current release readiness because they did not catch the active availability, sustained-history, and empty-comparison findings.

The previous free-tier projection also showed a tight write-side margin, so P0 persistence changes require fresh measurement before deployment.

## Operating restrictions

- Do not enable Mainnet.
- Do not add another production cron.
- Do not shorten the five-minute cadence.
- Do not describe the product as healthy, release ready, pre-soak ready, or stably operating while issue #463 remains open.
- Do not treat HTTP 200 as healthy when the response represents unavailable data.
- Preserve the active checkpoint identity.
- Preserve free-tier safety margins.

## Next action

1. Complete CI for PR #464.
2. Merge and deploy the current-state fallback and truthful differential gate only after all checks pass.
3. Verify public current-state behavior under a controlled release-source failure.
4. Implement and measure the sustainable history-tail repair.
5. Restore independent current-state, history, counts, and reconciliation freshness gates.
6. Start a new release-qualifying Devnet window only after the P0 exit criteria pass.
