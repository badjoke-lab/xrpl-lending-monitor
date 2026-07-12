# Implementation status

Last updated: 2026-07-12, after the recovered live Devnet checkpoint cutover.

## Current phase

XRPL Lending Monitor is publicly operating on XRPL Devnet.

Current formal state:

> Public Devnet operation restored; a new 24-hour release-qualification soak is active.

Mainnet remains disabled.

The previous release acceptance was correctly withdrawn after the live-source audit found stale immutable history and a fast-lane continuity gap. That stale checkpoint has now been replaced and the old soak remains invalid. Release completion is not claimed until the new soak finishes.

## Recovered production checkpoint

The guarded recovery cutover completed successfully on GitHub Actions run `29182796719`.

Production history and current state were promoted as one aligned checkpoint:

- network: `devnet`;
- epoch: `devnet-3371675`;
- ledger index: `3,589,759`;
- ledger hash: `1F2A8F4C9BC1A4CBED24DE04E6D5963E10BD7A77C334E97B51E74887CF277286`;
- snapshot: `devnet-3589759-1f2a8f4c9bc1`;
- history publication SHA-256: `b293b309c0b320ab5ea88a2327457128e901632f5781f76842fbc6e19d941d29`;
- current-state manifest SHA-256: `2038e0cd5f75748e46adae9d4bd4bd4f2a26e7190b69bdfc02ffc7bbaa8f3995`.

The target ledger/hash matched both configured live XRPL Devnet sources before production writes.

## Post-cutover live verification

The retained final verification passed with:

- live XRPL ledger: `3,590,433`;
- public current-state ledger: `3,590,432`;
- source lag: `1` ledger;
- current-state age: `6` seconds;
- fast-lane source: `fast_lane`;
- exact projection mismatches: `0`;
- collector status: `healthy`;
- Mainnet enabled: `false`.

Immutable/indexed history was confirmed at:

- end ledger: `3,589,759`;
- ledger count: `218,084`;
- segment count: `441`;
- exact-index buckets: `256`;
- exact-index records: `8,195,203`.

Production current-object counts at the promoted checkpoint were:

- Vaults: `837,791`;
- Loan Brokers: `553,468`;
- Loans: `238,226`;
- total current objects: `1,629,485`.

## Production schedules

Cloudflare Workers has exactly one production cron schedule:

```text
*/5 * * * *
```

Inside that single five-minute schedule:

- every tick runs the compact current-state fast lane;
- UTC four-hour boundaries additionally run the protected canonical reconciliation tail.

Separately, GitHub Actions runs rolling checkpoint maintenance every three hours. That maintenance advances immutable history, exact index, and rebuilt current state together when required, verifies their ledger/hash identity, and uses the guarded cutover path. It is not a second Cloudflare cron.

## D1 free-plan headroom at cutover

- rows read: `473,223`;
- rows written: `11,574`;
- rows read remaining: `4,526,777`;
- rows written remaining: `88,426`.

The cutover remained inside the configured fail-closed free-plan gates.

## New 24-hour soak

The failed earlier soak is not reused.

The new qualification window is:

- start: `2026-07-12T06:40:00Z` (`2026-07-12 15:40 JST`);
- end: `2026-07-13T06:40:00Z` (`2026-07-13 15:40 JST`).

The start is the first clean five-minute boundary after the recovered fast lane was rebound and began refilling from the promoted checkpoint.

Required exit conditions remain:

- no fast-lane run gap above `420` seconds;
- no failed fast-lane status;
- current-state source lag no greater than `10` ledgers at audit time;
- current-state age within ten minutes;
- immutable/indexed-history coverage within the declared five-hour bound;
- exact ledger hashes match XRPL source data;
- sampled Vault, Loan Broker, and Loan objects match live ledger entries;
- no projection mismatch, cursor gap, tombstone regression, pagination failure, or HTTP 5xx;
- D1 remains within free-plan headroom;
- Mainnet remains disabled.

## Evidence

- recovery orchestration run: `29182498185`;
- guarded live cutover run: `29182796719`;
- recovery artifact: `transient-rehearsal-recovery`;
- cutover artifact: `rolling-checkpoint-live-cutover`;
- final current-state lag: `1` ledger;
- final current-state age: `6` seconds;
- production cron: one `*/5 * * * *` schedule.

## Formal decision

The site is now in real public Devnet operation, not merely a static or stale recovery build.

Release qualification remains open until the new 24-hour soak is reconciled. No Mainnet transition is authorized by this status.
