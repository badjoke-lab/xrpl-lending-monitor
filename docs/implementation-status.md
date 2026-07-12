# Implementation status

Last updated: `2026-07-12T16:30Z`.

## Current phase

XRPL Lending Monitor has completed the runtime, source-comparison, browser, and free-tier projection gates required before the first 24-hour production soak.

The project is now in:

> Pre-soak ready on XRPL Devnet. The 24-hour soak has not started.

Mainnet remains disabled.

## Active production architecture

The active architecture is `rolling_checkpoint_fast_lane_v1`.

- Network: `devnet`
- Mainnet enabled: `false`
- Public Worker: `https://xrpl-lending-monitor.badjoke-lab.workers.dev`
- Production cron: exactly one `*/5 * * * *` schedule
- Protected canonical-overlay collector cadence: four hours
- Current-state source: five-minute `fast_lane`
- Immutable history mode: `hybrid`

## Production checkpoint

The Worker, immutable history, replacement base, and fast-lane binding use the same checkpoint identity:

- Epoch: `devnet-3371675`
- Snapshot: `devnet-3592674-0373cda0b0cd`
- Ledger: `3,592,674`
- Ledger hash: `0373CDA0B0CD8486C0C55C5B5DD460501419367BD76D146E4A718EBD9DD8A893`
- History publication SHA-256: `8efd8f6af2055ffb0ff64d92585edbb70ad574666a887548e601f7b202dbb440`

The final checkpoint-bound production deploy completed successfully in run `29199475629`.

## Completed pre-soak gates

### Runtime acceptance

Run `29198248935` passed the current-architecture runtime acceptance gate.

Confirmed:

- Devnet-only runtime boundary;
- Mainnet disabled;
- one protected five-minute cron;
- replacement base replayed at the production checkpoint;
- fast-lane base binding aligned with the production checkpoint;
- public current-state source set to `fast_lane`;
- current-state freshness within 10 ledgers and 10 minutes;
- zero exact projection mismatches;
- recent successful five-minute runs;
- protected collector with zero consecutive failures and no current error.

### Direct XRPL source comparison

Run `29198537310` compared nine public objects with XRPL Devnet at the exact public watermark:

- 3 Vaults;
- 3 LoanBrokers;
- 3 Loans.

Both configured Devnet RPC sources returned the same ledger index and ledger hash as the public watermark. All nine object identities and common fields matched after directory-node hexadecimal normalization. Total samples: `9`; mismatches: `0`; result: passed.

### Browser and behavior regression

Run `29199948639` passed the current-architecture browser exit gate.

- Routes: `15 / 15`
- Required behavior checks: `8 / 8`
- Technical findings: `0`
- Collector status presented to the browser: healthy
- Browser-observed fast-lane lag: `0`

The verified route matrix includes overview, object lists and details, activity and transaction detail, lifecycle, archive list and detail, cover/loss, search, and network status.

### D1 free-tier projection

Run `29200220649` passed the conservative normal-operation projection.

Method:

- 24 steady-state five-minute samples with `lag_ledgers <= 10`;
- five-minute p95 multiplied by 288 daily runs;
- six protected four-hour collector runs;
- reserve for two maximum-observed reanchor runs.

Projection:

- Read rows: `77,152 / 5,000,000` (`1.54304%`)
- Write rows: `87,276 / 100,000` (`87.276%`)
- Remaining read rows: `4,922,848`
- Remaining write rows: `12,724`
- Required maximum: below `90%`
- Result: passed

The write-side margin is materially tighter than the read-side margin. Five-minute operation is accepted for the soak, but no three-minute, two-minute, or one-minute cadence is authorized by this result.

## Repairs completed before acceptance

- Fixed the exact Loan history HTTP 500 / Cloudflare 1101 failure.
- Capped exact-history asset and record reads.
- Removed three obsolete workflows that could overwrite the active production checkpoint.
- Pinned the static Wrangler fallback identity to ledger `3,592,674` so plain or fallback deployments cannot restore ledger `3,540,657`.
- Rebound the D1 fast-lane shadow to the active production base.
- Restored the protected five-minute cron after bounded catch-up.
- Increased only the immutable activity read budget from the generic four-segment/one-second budget to the existing audit budget of 24 segments/five seconds, preventing sparse activity reads from intermittently returning a bounded-read 503.
- Replaced the superseded browser exit dependency on a same-day D1-total file with the current-architecture readiness gate and a separate normal-operation D1 projection.

## Operating restrictions

- Do not enable Mainnet.
- Do not add another production cron.
- Do not shorten the five-minute cadence during the first soak.
- Do not treat diagnostic-day D1 totals as normal operating cost.
- Do not start a reanchor, rolling checkpoint cutover, or heavy audit during the soak unless recovery requires it.
- Preserve the production checkpoint identity across all deployment paths.

## Next action

The next action is the first 24-hour Devnet production soak. It must start as a separate, explicit operation with retained start and end evidence.

At this status timestamp, the soak has not started.
