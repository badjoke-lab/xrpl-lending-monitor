# R4C2d Supabase resource and no-charge evidence

Date: `2026-08-03`

## Decision boundary

This document records retained evidence for the conditional Supabase Free Devnet profile. It does not select the profile and does not authorize a public-reader cutover, R5 recovery, Mainnet, stabilization, or soak.

Controlling result:

- G7 throughput: `qualified`;
- G1 no mandatory payment/card: `pass`;
- G2 no automatic paid overage: `pass`;
- G8 resource qualification: `incomplete`;
- G9 operator independence: `unresolved`;
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

## Free plan and no-charge behavior

PR `#1151` originally called Studio-internal `/platform` usage and subscription endpoints. Remote run `30785068166` proved that those endpoints reject the configured personal access token with `JWT could not be decoded`. No usage conclusion from that failed attempt is retained.

PR `#1152` replaced those calls with PAT-compatible public Management API reads:

- exact project: `GET /v1/projects/{ref}`;
- provider-returned organization: `GET /v1/organizations/{slug}`.

Remote run `30785807617` proved:

- PAT-compatible Management API access: `true`;
- exact project identity: `true`;
- exact project-to-organization binding: `true`;
- organization plan: `free`;
- Free plan confirmed: `true`.

Supabase's official billing documentation states that:

- Spend Cap configuration is a Pro-plan feature;
- the Free plan is not charged for over-usage;
- exceeding a Free quota leads to notification, a grace period, and eventual service restriction rather than paid overage;
- Free egress and Edge Function invocation tables contain quota values but no over-usage price.

Therefore the retained R4 decision treats:

- G1 no mandatory payment/card: `pass`;
- G2 no automatic paid overage: `pass`;
- usage-billing flag: not required for the Free plan;
- automatic paid overage possible: `false` by exact plan identity plus official policy;
- billing/no-charge qualification: `pass`.

This policy result does not prove provider egress consumption. Egress remains a separate G8 resource requirement.

Official policy references:

- `https://supabase.com/docs/guides/platform/cost-control`;
- `https://supabase.com/docs/guides/platform/billing-faq`;
- `https://supabase.com/docs/guides/platform/manage-your-usage/egress`;
- `https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations`.

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
| Provider egress | unavailable | No retained PAT-compatible provider usage counter |
| Free plan identity | measured | Exact project-to-organization binding reports `free` |
| No automatic paid overage | policy-proved | Free-plan over-quota behavior is restriction, not paid overage |
| Billing/no-charge qualification | passed | Exact Free plan identity plus official provider policy |
| Operator independence | unresolved | Complete retained rollback and unattended operation evidence is not yet bound to profile revision 2 |

## Current R4B decision

The machine-readable revision-2 decision is [`r4c2d-supabase-r4b-decision-2026-08-03.json`](r4c2d-supabase-r4b-decision-2026-08-03.json).

- classification: `conditional_candidate`;
- selection: `not_selected`;
- passed gates: `8`;
- failed gates: `0`;
- unresolved gates: `G8`, `G9`;
- scoring allowed: `false`.

## Remaining work

The Supabase profile cannot become a qualified candidate until:

1. usable maximum-memory evidence is retained, or a formally accepted alternative bound is proved without describing it as a provider counter;
2. provider egress evidence is retained, or the R4 contract records that the unavailable counter makes G8 fail;
3. complete rollback and unattended operator-independence evidence closes G9;
4. the R4B decision is regenerated with no unresolved gates;
5. R4E explicitly selects the qualified profile or records `no_profile_qualified`.

R5 must not begin before that decision.