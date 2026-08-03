# R4C2d Supabase resource and no-charge evidence

Date: `2026-08-03`

## Decision boundary

This document records retained evidence for the conditional Supabase Free Devnet profile. It does not select the profile and does not authorize a public-reader cutover, R5 recovery, Mainnet, stabilization, or soak.

Controlling result:

- G7 throughput: `qualified`;
- G8 resource and no-charge qualification: `incomplete`;
- profile selected: `false`;
- G8 qualified: `false`.

## Fail-closed resource guard

PR `#1145` added the isolated resource guard and its remote qualification surface.

Remote run `30779476979` proved six exact injected halt paths:

1. database storage;
2. database connections;
3. Edge wall time;
4. stale or missing external resource snapshot;
5. projected function invocations;
6. deployed bundle size.

For every injected failure, the qualification required:

- halt before tick, work, message, or successor reservation;
- no committed work;
- no invalid successor;
- active watermark non-regression;
- active epoch and base identity preservation;
- active profile read-only behavior.

The guard thresholds are intentionally below the configured hard ceilings:

| Resource | Project halt | Hard ceiling |
| --- | ---: | ---: |
| Database size | 400,000,000 bytes | 500,000,000 bytes |
| Database connections | 45 | 60 |
| Edge wall time | 45,000 ms | 150,000 ms |
| Projected function invocations per 31 days | 400,000 | 500,000 |
| Largest deployed bundle | 4,000,000 bytes | 5,000,000 bytes |

Passing injected fault behavior does not prove that every live provider counter is available.

## Official function statistics

PR `#1150` replaced the failing Logs SQL invocation query with the official `functions.combined-stats` Management endpoint used by Supabase Studio.

The controlling successful retry of run `30784402995` measured every active deployed function over the one-day provider statistics window:

- active functions: `14`;
- metric rows: `120`;
- classified invocations: `3,717`;
- total requests: `3,717`;
- projected invocations over 31 days: `115,227`;
- CPU p50/p95/max from maximum-CPU buckets: `53 / 199 / 341 ms`;
- average-memory p50/p95/max: `10.240385818481446 / 10.564728736877441 / 10.76615047454834 MB`;
- maximum-execution p50/p95/max: `1,908 / 5,105 / 9,960 ms`.

The same run retained:

- database size: `81,939,603` bytes;
- database connections: `10`;
- maximum measured Edge wall time: `5,202.7498 ms`;
- largest exact deployed bundle: `103,351` bytes;
- live guard allowed: `true`;
- live guard failures: `[]`;
- all six injected fail-closed paths proved: `true`;
- active profile read-only: `true`;
- G8 qualified: `false`;
- profile selected: `false`.

The provider statistics expose maximum CPU and average memory. Average memory is not accepted as exact maximum-memory evidence.

## Free plan identity

PR `#1151` originally called Studio-internal `/platform` usage and subscription endpoints. Remote run `30785068166` proved that those endpoints reject the configured personal access token with `JWT could not be decoded`. No usage or billing claim from that failed attempt is retained.

PR `#1152` replaced those calls with PAT-compatible public Management API reads:

- exact project: `GET /v1/projects/{ref}`;
- provider-returned organization: `GET /v1/organizations/{slug}`.

Remote run `30785807617` proved:

- PAT-compatible Management API access: `true`;
- exact project identity: `true`;
- exact project-to-organization binding: `true`;
- organization plan: `free`;
- Free plan confirmed: `true`.

The retained evidence deliberately keeps these fields false:

- organization usage coverage;
- uncached egress coverage;
- cached egress coverage;
- usage-billing flag coverage;
- automatic-overage API coverage;
- billing and overage qualification.

Free-plan identity and the provider's Free no-charge policy are not substituted for unavailable project usage or automatic-overage counters.

## Memory capability correction

PR `#1153` added six deterministic `Deno.memoryUsage()` samples to every real 24-ledger steady tick and retained six completed ticks in run `30785890154`.

The workflow succeeded, but all `36` retained samples reported zero for:

- RSS;
- heap total;
- heap used;
- external memory.

Those values do not prove zero memory consumption and do not prove `200 MiB` of headroom. They show that usable in-process memory counters were not exposed by this Supabase Edge runtime.

Issue `#1109` contains an explicit correction invalidating the zero-headroom interpretation.

PR `#1154` makes that correction executable:

- every retained memory counter is inspected;
- all-zero counters are classified as unavailable;
- minimum, p50, p95, maximum, and headroom become `null` or `unavailable`;
- lifecycle sampling remains recorded;
- memory measurement available: `false`;
- memory high-water qualified: `false`;
- memory fail-closed headroom proved: `false`;
- memory coverage not overstated: `true`;
- G7 qualified remains `true`;
- G8 qualified remains `false`;
- profile selected remains `false`.

## Live coverage matrix

| Requirement | Result | Controlling interpretation |
| --- | --- | --- |
| Database size | measured | Below the 400,000,000-byte halt threshold in the retained run |
| Database connections | measured | Below the 45-connection halt threshold |
| Edge wall time | measured | Below the 45,000-ms halt threshold |
| Function invocations | measured | Official one-day statistics, projected to 31 days below 400,000 |
| Deployed bundle size | measured | Exact same-commit bundle identity below 4,000,000 bytes |
| Edge CPU | measured | Official maximum-CPU statistics below the runtime hard limit |
| Edge memory maximum | unavailable | Average memory exists; in-process maximum counters returned all zero and are rejected |
| Provider egress | unavailable | No retained PAT-compatible project usage counter |
| Usage-billing flag | unavailable | Studio JWT-only endpoint is not usable from the verifier |
| Automatic-overage API state | unavailable | Not exposed through the retained PAT-compatible evidence path |
| Free plan identity | measured | Exact project-to-organization binding reports `free` |
| Billing/no-charge qualification | incomplete | Free identity is not enough to replace missing usage and overage evidence |

## Remaining G8 work

G8 cannot pass until the remaining requirements are either proved or the profile is rejected through the formal R4 decision:

1. usable maximum-memory evidence or a formally accepted alternative bound that is not described as a provider counter;
2. retained provider egress evidence or a formal determination that the required counter is unavailable;
3. retained billing and automatic-overage evidence or a formal determination that the Free profile cannot satisfy the hard gate;
4. final reconciliation of all resource ceilings, project halt thresholds, and unavailable provider surfaces;
5. an explicit R4B/R4E outcome: selected qualified profile or `no_profile_qualified`.

R5 must not begin before that decision.