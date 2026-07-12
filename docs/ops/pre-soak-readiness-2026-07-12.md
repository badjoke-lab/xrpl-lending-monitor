# Pre-soak readiness record — 2026-07-12

## Decision

XRPL Lending Monitor completed the runtime, source-comparison, browser, and free-tier projection gates required before the first 24-hour XRPL Devnet production soak.

Formal state:

> Pre-soak ready on XRPL Devnet. The 24-hour soak has not started.

Mainnet remains disabled.

## Production identity

- Worker: `https://xrpl-lending-monitor.badjoke-lab.workers.dev`
- Architecture: `rolling_checkpoint_fast_lane_v1`
- Network: `devnet`
- Mainnet enabled: `false`
- Cron: exactly one `*/5 * * * *`
- Epoch: `devnet-3371675`
- Snapshot: `devnet-3592674-0373cda0b0cd`
- Ledger: `3,592,674`
- Ledger hash: `0373CDA0B0CD8486C0C55C5B5DD460501419367BD76D146E4A718EBD9DD8A893`
- History publication SHA-256: `8efd8f6af2055ffb0ff64d92585edbb70ad574666a887548e601f7b202dbb440`

The final checkpoint-bound production deploy completed successfully in run `29199475629`.

## Root causes repaired

### Obsolete production writers

Three obsolete workflows could deploy the static Wrangler configuration directly to the production Worker and overwrite the active rolling checkpoint. They were disabled and removed from `main`.

The static fallback configuration was also pinned to the active checkpoint so any plain or fallback deployment can no longer restore ledger `3,540,657`.

### Fast-lane base mismatch

The Worker configuration and D1 fast-lane base binding had diverged. The D1 shadow was rebound to snapshot `devnet-3592674-0373cda0b0cd`, ledger `3,592,674`, and the verified hash. Projection parity returned zero mismatches.

A bounded temporary one-minute catch-up was used only to close the repair backlog. Its cleanup restored the protected five-minute cron. The production schedule remains exactly one `*/5 * * * *` trigger.

### Exact history failure

The exact Loan history endpoint exceeded Worker read limits. Exact-history reads were capped by both asset count and record count. The previously failing Loan history URL returned HTTP 200 after deployment.

### Sparse immutable activity reads

Small newest-first activity requests could intermittently return a bounded-read 503 when recent immutable segments contained few protocol events. Only the activity immutable-read budget was increased from the generic four-segment/one-second limit to the existing audit limit of 24 segments/five seconds.

### Superseded browser evaluator

The earlier browser evaluator required a same-day aggregate D1 usage file. That file represented repair and diagnostic traffic rather than normal five-minute operation. The final current-architecture evaluator instead requires the public pre-soak readiness gate, collector health, the exact 15-route matrix, all required behavior checks, zero technical findings, and retained request-count evidence. D1 normal-operation cost is evaluated separately.

## Retained acceptance evidence

### Runtime acceptance

Run `29198248935` passed the runtime acceptance gate.

Required invariants included:

- Devnet-only runtime;
- Mainnet disabled;
- one five-minute cron;
- aligned immutable history, replacement base, and fast-lane binding;
- public source `fast_lane`;
- current-state age within ten minutes;
- source lag within ten ledgers;
- zero exact projection mismatches;
- zero collector failures and no current collector error;
- continuation verification and M1 exit readiness.

### Direct XRPL source comparison

Run `29198537310` passed.

At the exact public watermark, both configured XRPL Devnet RPC sources returned the same ledger index and ledger hash. Three Vaults, three LoanBrokers, and three Loans were compared with direct `ledger_entry` responses.

- Total samples: `9`
- Passed samples: `9`
- Mismatches: `0`

Directory-node fields were normalized by hexadecimal numeric equivalence.

### Browser and behavior regression

Run `29199948639` passed the final current-architecture browser gate.

- Routes: `15 / 15`
- Required behavior checks: `8 / 8`
- Technical findings: `0`
- Browser collector status: healthy
- Browser collector lag: `0`
- Final exit evaluator: passed

Covered routes include overview, all object lists and details, activity, transaction detail, lifecycle, archive list and detail, cover/loss, search, and network status.

### D1 normal-operation projection

Run `29200220649` passed.

Projection method:

- 24 steady-state five-minute samples with `lag_ledgers <= 10`;
- five-minute p95 multiplied by 288 daily runs;
- six protected four-hour collector runs;
- reserve for two maximum-observed reanchor runs.

Measured five-minute cost:

- Read rows: min `10`, average `93.0833`, p95 `246`, max `373`
- Write rows: min `11`, average `94.0833`, p95 `247`, max `374`

Conservative daily projection:

- Read rows: `77,152 / 5,000,000` (`1.54304%`)
- Write rows: `87,276 / 100,000` (`87.276%`)
- Remaining read rows: `4,922,848`
- Remaining write rows: `12,724`
- Required maximum fraction: below `90%`
- Result: passed

The write margin is tight. This evidence authorizes the five-minute soak only. It does not authorize three-minute, two-minute, or one-minute production operation.

## Soak restrictions

During the first 24-hour soak:

- do not enable Mainnet;
- do not add a second cron;
- do not shorten the five-minute cadence;
- do not run heavy diagnostic scans unless required to investigate a failure;
- do not run a planned reanchor or rolling checkpoint promotion;
- retain start, intermediate, and end evidence;
- fail the soak if a required runtime invariant is violated.

## Next operation

Start the first 24-hour Devnet production soak as a separate explicit operation.

At the time of this record, the soak has not started.
