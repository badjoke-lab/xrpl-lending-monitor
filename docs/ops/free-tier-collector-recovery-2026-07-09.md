# Free-tier collector recovery — 2026-07-09

## Current production evidence

Cloudflare production Observability shows the scheduled collector cron firing every minute and failing with `outcome=exceededCpu`.

Observed fields from the shared Cloudflare event sample:

- `scriptName`: `xrpl-lending-monitor`
- `eventType`: `cron`
- `cron`: `* * * * *`
- `outcome`: `exceededCpu`
- `cpuTimeMs`: `10`
- wall time: roughly 4-6 seconds across repeated events

The latest GitHub catch-up runtime monitor rerun showed D1 daily usage had recovered, but the collector cursor did not advance. Therefore the active blocker is Worker CPU exhaustion in the scheduled collector path, not the UTC-day D1 quota.

## Recovery direction

The active recovery direction is free-tier stability over every-minute freshness:

1. move production scheduled collection away from every-minute execution;
2. reduce per-run collector work so each scheduled run can complete within the Worker Free CPU envelope;
3. keep collector integrity and D1 resource gates fail-closed;
4. verify that scheduled runs stop producing `exceededCpu`;
5. verify `cursor_delta > 0` and decreasing stale lag before returning to M5-5 browser evidence.

## Product tradeoff

Five-minute cadence is an accepted free-tier recovery compromise. It weakens near-real-time freshness compared with every-minute collection, but it is preferable to a every-minute collector that consistently fails and leaves public state stale.

Public copy and source-of-truth documents must not claim strict real-time or zero-lag operation while this recovery mode is active.

## Gate boundary

M5-5 remains blocked until retained recovery evidence proves the collector is healthy enough for the M5-5 browser preflight. M6-I1 remains blocked until M5-5 exit is reconciled.
