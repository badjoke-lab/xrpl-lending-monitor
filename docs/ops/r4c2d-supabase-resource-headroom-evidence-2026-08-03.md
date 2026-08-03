# R4C2d Supabase resource, no-charge, and operator evidence

Date: `2026-08-03`

## Final decision boundary

This document records the completed qualification of Supabase profile revision 2. It does not authorize a public-reader cutover, R5 recovery, Mainnet, stabilization, or soak.

Controlling result:

- G1 no mandatory payment/card: `pass`;
- G2 no automatic paid overage: `pass`;
- G7 throughput: `pass`;
- G8 resource fail-closed: `fail`;
- G9 operator independence: `pass`;
- G10 production boundary: `pass`;
- profile classification: `rejected`;
- profile selected: `false`.

Remote run `30800402654`, commit `db82291a7df3e8d4dfa458891e0a714f7d8d346b`, completed the final G8 reconciler and produced:

- verifier: `success`;
- G8 status: `fail`;
- disposition: `reject_profile`;
- failure reasons:
  - `provider_exact_peak_memory_unavailable`;
  - `provider_egress_bytes_unavailable`;
  - `runtime_total_memory_counter_unavailable`;
  - `memory_headroom_not_qualified`.

Passing database, connection, wall-time, invocation, bundle, CPU, billing, and injected fault checks cannot override a failed hard gate.

## Retained fail-closed resource guard

PR `#1145` added the isolated resource guard and its remote qualification surface. Remote run `30779476979` proved exact injected halt paths for:

1. database storage;
2. database connections;
3. Edge wall time;
4. stale or missing external resource evidence;
5. projected function invocations;
6. deployed bundle size.

Every injected failure halted before tick, work, message, or successor reservation, committed no work, preserved the active watermark, and left the active profile read only.

The retained project halt thresholds remain below the configured hard ceilings:

| Resource | Project halt | Hard ceiling |
| --- | ---: | ---: |
| Database size | 400,000,000 bytes | 500,000,000 bytes |
| Database connections | 45 | 60 |
| Edge wall time | 45,000 ms | 150,000 ms |
| Projected function invocations per 31 days | 400,000 | 500,000 |
| Largest deployed bundle | 4,000,000 bytes | 5,000,000 bytes |

These checks prove the implemented guards. They do not prove that every required provider counter exists.

## Official function statistics

The controlling successful resource run measured every active deployed function through the official `functions.combined-stats` Management endpoint:

- active functions: `14`;
- metric rows: `120`;
- classified one-day invocations: `3,717`;
- projected invocations over 31 days: `115,227`;
- CPU p50/p95/max: `53 / 199 / 341 ms`;
- average-memory p50/p95/max: `10.240385818481446 / 10.564728736877441 / 10.76615047454834 MB`;
- maximum-execution p50/p95/max: `1,908 / 5,105 / 9,960 ms`;
- database size: `81,939,603` bytes;
- database connections: `10`;
- maximum measured Edge wall time: `5,202.7498 ms`;
- largest exact deployed bundle: `103,351` bytes.

The provider endpoint exposes average memory, not an exact per-execution peak. Average memory is retained as a weaker statistic and is not accepted as peak-memory evidence.

## Free plan and no-charge behavior

PAT-compatible public Management API reads proved the exact project-to-organization binding and organization plan `free`.

The retained billing decision is:

- no mandatory paid plan or payment method: `pass`;
- automatic paid overage possible: `false`;
- quota exhaustion behavior: notification, grace period, then service restriction;
- billing/no-charge qualification: `pass`.

This cost result does not substitute for resource-consumption evidence. Free-plan identity and request counts do not prove provider egress bytes.

## Memory capability corrections

Six completed steady ticks retained `36` lifecycle samples. RSS was zero in every sample while some heap or external counters were nonzero.

That observation **does not prove zero memory consumption** and does not prove `200 MiB` of headroom. For the provider total-memory ceiling, **partial heap or external counters cannot substitute** for an unavailable RSS or total-memory counter.

The controlling interpretation is therefore:

- lifecycle sampling executed: `true`;
- exact maximum memory available: `false`;
- usable total-memory counter available: `false`;
- zero RSS interpreted as zero usage: `false`;
- partial counters accepted as total memory: `false`;
- memory high-water qualified: `false`;
- memory headroom qualified: `false`.

Run `30792758520` also exposed `process_virtual_memory_max_bytes` on a generic project metrics endpoint. That metric is not bound to an Edge Function execution and is not accepted as exact peak Edge memory. Only function-scoped evidence can satisfy that requirement.

## Provider egress boundary

The PAT-accessible probe reached the public usage, request-count, combined-statistics, and metrics surfaces. It found request counters but no provider egress-byte field. Dashboard organization usage rejected the PAT.

The controlling interpretation is:

- request counts available: `true`;
- provider egress bytes available: `false`;
- request counts substituted for egress bytes: `false`;
- theoretical payload projections substituted for provider evidence: `false`.

Because provider egress evidence is a required revision-2 hard-gate input, unavailability causes G8 failure rather than indefinite `unresolved` status.

## G9 operator-independence qualification

Remote run `30789994825`, commit `535bda53ad44ed1cfc0969ccf72c889e9254d124`, proved revision-2 scripted operation for deployment, migrations, credential rotation, checkpoint, canonical export, repeatable restore convergence, post-restore continuation, interruption rollback, terminal halt, artifact upload, and Issue publication.

No routine Dashboard or interactive terminal operation is required. G9 remains `pass`; it does not override G8.

## Final R4B and R4E outcome

The revision-2 machine-readable R4B decision is [`r4c2d-supabase-r4b-decision-2026-08-03.json`](r4c2d-supabase-r4b-decision-2026-08-03.json).

- classification: `rejected`;
- selection: `not_selected`;
- passed gates: `9`;
- failed gates: `1`;
- unresolved gates: `0`;
- failed gate: `G8`;
- scoring allowed: `false`;
- decision digest: `d1577a896e3f4e512a362586ae30990aceb5142f0783feb529626fa6f035e111`.

The R4E outcome is [`r4e-deployment-profile-outcome-2026-08-03.json`](r4e-deployment-profile-outcome-2026-08-03.json):

- outcome: `no_profile_qualified`;
- selected profile: `null`;
- R5 authorized: `false`;
- outcome digest: `c04d75c38c103b9549351ca92a8dab113e754e7e2ed720b93a17f58ff138bacb`.

## Next work

The next engineering phase is `R4C3`, not R5. It must define and qualify a Supabase revision-3 profile whose resource boundary is based on conservative application-owned accounting and pre-reservation halts, without claiming that unavailable provider counters were measured.

Until revision 3 passes every G1–G10 hard gate and is explicitly selected:

- the retired Cloudflare collector remains halted;
- the legacy public reader remains authoritative;
- Mainnet remains disabled;
- recovery, stabilization, and soak remain prohibited.
