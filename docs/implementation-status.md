# Implementation status

Last updated: `2026-08-03`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The controlling engineering phase is `R4C2d`: Supabase Free Devnet throughput, resource, and no-charge qualification.

The retired Cloudflare fixed-32-ledger recovery remains halted. Worker Cron remains empty, Mainnet remains disabled, the legacy public reader remains authoritative, and no R5 recovery, stabilization qualification, or soak is active.

The Supabase Free Devnet profile remains **conditional and unselected**.

## Current gate result

| Gate | Result | Controlling interpretation |
| --- | --- | --- |
| G3 durable scheduler and fault behavior | proved | Remote isolated qualification passed |
| G4 transactional completion and rollback | proved | Remote rollback and exact completion passed |
| G5 committed-only reads and source-bound fences | proved | Remote committed-reader qualification passed |
| G6 export, restore, duplicate convergence, and continuation | proved | Complete-state and post-restore qualification passed |
| G7 sustained throughput | **qualified** | Steady and catch-up components both passed |
| G8 resource and no-charge | **incomplete** | Several counters are measured; memory, egress, and billing evidence remain incomplete |
| G1, G2, G9, G10 | pending reconciliation | Must be resolved by final R4B/R4E decision |
| profile selected | `false` | No profile selection has occurred |

R4C2c behavioral qualification is complete. That result is not R4 completion and is not a production-cutover decision.

## Controlling evidence

### Qualification contract and earlier phases

- R4 qualification contract: [`ops/r4-deployment-profile-qualification-plan-2026-08-01.md`](ops/r4-deployment-profile-qualification-plan-2026-08-01.md)
- R4 initial matrix: [`ops/r4-initial-profile-matrix-2026-08-01.json`](ops/r4-initial-profile-matrix-2026-08-01.json)
- R4B evaluator evidence: [`ops/r4b-profile-qualification-evaluator-evidence-2026-08-01.md`](ops/r4b-profile-qualification-evaluator-evidence-2026-08-01.md)
- R4C1 local SQLite evidence: [`ops/r4c1-local-sqlite-service-evidence-2026-08-01.md`](ops/r4c1-local-sqlite-service-evidence-2026-08-01.md)
- R4C2a remote probe: [`ops/r4c2-supabase-remote-probe-evidence-2026-08-02.md`](ops/r4c2-supabase-remote-probe-evidence-2026-08-02.md)
- R4C2b durable phase chain: [`ops/r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.md`](ops/r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.md)

### R4C2c behavioral evidence

- seven-class executor: [`ops/r4c2c-supabase-seven-class-remote-evidence-2026-08-02.md`](ops/r4c2c-supabase-seven-class-remote-evidence-2026-08-02.md)
- committed reader: [`ops/r4c2c-supabase-committed-reader-evidence-2026-08-02.md`](ops/r4c2c-supabase-committed-reader-evidence-2026-08-02.md)
- historical witness: [`ops/r4c2c-supabase-historical-witness-remote-evidence-2026-08-02.md`](ops/r4c2c-supabase-historical-witness-remote-evidence-2026-08-02.md)
- standard multi-chunk evidence: [`ops/r4c2c-supabase-multichunk-remote-evidence-2026-08-02.md`](ops/r4c2c-supabase-multichunk-remote-evidence-2026-08-02.md)
- complete-state transfer: [`ops/r4c2c-supabase-complete-state-transfer-remote-evidence-2026-08-02.md`](ops/r4c2c-supabase-complete-state-transfer-remote-evidence-2026-08-02.md)
- post-restore continuation: [`ops/r4c2c-supabase-restore-continuation-remote-evidence-2026-08-02.md`](ops/r4c2c-supabase-restore-continuation-remote-evidence-2026-08-02.md)
- remote fault qualification: [`ops/r4c2c-supabase-remote-fault-evidence-2026-08-02.md`](ops/r4c2c-supabase-remote-fault-evidence-2026-08-02.md)

### R4C2d throughput and resource evidence

- normal-cadence/resource baseline: [`ops/r4c2d-supabase-throughput-resource-baseline-evidence-2026-08-03.md`](ops/r4c2d-supabase-throughput-resource-baseline-evidence-2026-08-03.md)
- isolated catch-up throughput: [`ops/r4c2d-supabase-isolated-catchup-throughput-evidence-2026-08-03.md`](ops/r4c2d-supabase-isolated-catchup-throughput-evidence-2026-08-03.md)
- network-inclusive steady throughput: [`ops/r4c2d-supabase-network-steady-throughput-evidence-2026-08-03.md`](ops/r4c2d-supabase-network-steady-throughput-evidence-2026-08-03.md)
- resource and no-charge evidence: [`ops/r4c2d-supabase-resource-headroom-evidence-2026-08-03.md`](ops/r4c2d-supabase-resource-headroom-evidence-2026-08-03.md)
- machine-readable resource gate state: [`ops/r4c2d-resource-gate-status-2026-08-03.json`](ops/r4c2d-resource-gate-status-2026-08-03.json)
- runtime invariants: [`history-runtime-contract.md`](history-runtime-contract.md)
- resource gates: [`resource-envelope.md`](resource-envelope.md)

## R4C2c completion

R4C2c is complete for the planned remote behavioral qualification. Retained evidence covers:

- active seven-class phase execution and committed-reader semantics;
- `237` real historical Devnet rows across all seven semantic classes;
- historical pages `100 / 100 / 37` and a non-empty `16`-row cross-class Loan relationship query;
- one real `116`-row multi-chunk work with exact payload, commit, mutation, and reader parity `40 / 40 / 36`;
- exact collection, scheduler, publication, and maintenance export;
- typed empty-target restore with canonical text and SHA-256 parity;
- duplicate restore convergence and digest-tamper rejection;
- post-restore `scan -> commit -> finalize -> next scan` continuation;
- transactional interruption rollback;
- exact retry/backoff and stale-lease reclaim;
- terminal integrity halt with no invalid successor;
- duplicate phase and terminal replay convergence;
- active-profile isolation for every isolated unit.

## G7 throughput qualification

### Rejected legacy cadence

Run `30754437078`, attempt `2`, measured the old one-phase-per-cron cadence.

| Window | Average/min | p95/min | Complete work p95 |
| --- | ---: | ---: | ---: |
| 60 minutes | 0.316667 | 1 | 120,899.35 ms |
| 360 minutes | 0.330556 | 1 | 120,580.95 ms |
| 1,440 minutes | 0.144444 | 1 | 120,463.4 ms |

That cadence failed the steady threshold and was not promoted.

### Catch-up component

Run `30755497115` completed five trials of 64 real committed Devnet works.

- total works: `320`;
- completed phases: `960`;
- minimum: `12,563.651375831556/min`;
- p50: `13,975.162925561042/min`;
- p95: `14,178.400673920027/min`;
- maximum: `14,225.868101463015/min`;
- required threshold: `>30/min`;
- all completed phases used attempt `1`;
- committed-row count/digest and target-watermark parity passed;
- active source remained read only.

### Network-inclusive steady component

The retained six-minute design fetches, parses, normalizes, and atomically commits 24 exact Devnet ledgers per internal minute bucket through the Lending parser and seven-class normalizer.

The controlling successful resource run `30784402995` retained the same fixed contract:

- six consecutive completed minute buckets;
- minute rates: `[24, 24, 24, 24, 24, 24]`;
- p50/p95/max: `24 / 24 / 24` ledgers/minute;
- exact isolated target advance: `144` ledgers;
- all completed attempts: `1`;
- active source epoch and base identity preserved;
- active source remained read only.

Steady p95 passed the required value above `21/min`. Combined with the catch-up pass, **G7 is qualified**.

## G8 measured resource state

### Fail-closed guard behavior

PR `#1145` and remote run `30779476979` proved six exact injected halt paths:

1. database storage;
2. database connections;
3. Edge wall time;
4. stale or missing external snapshot;
5. projected function invocations;
6. deployed bundle size.

Each injected failure halted before tick, work, message, or successor reservation and preserved active source identity.

Project halt thresholds remain below hard ceilings:

| Resource | Halt | Hard ceiling |
| --- | ---: | ---: |
| Database size | 400,000,000 bytes | 500,000,000 bytes |
| Database connections | 45 | 60 |
| Edge wall time | 45,000 ms | 150,000 ms |
| Projected 31-day function invocations | 400,000 | 500,000 |
| Largest deployed bundle | 4,000,000 bytes | 5,000,000 bytes |

### Official function statistics

PR `#1150` moved invocation and runtime statistics to the official `functions.combined-stats` Management endpoint used by Supabase Studio.

Run `30784402995` measured:

- active functions: `14`;
- metric rows: `120`;
- classified invocations in one day: `3,717`;
- projected invocations over 31 days: `115,227`;
- maximum CPU: `341 ms`;
- maximum observed average-memory bucket: `10.76615047454834 MB`;
- maximum execution time: `9,960 ms`;
- database size: `81,939,603` bytes;
- database connections: `10`;
- maximum Edge wall time: `5,202.7498 ms`;
- largest exact deployed bundle: `103,351` bytes;
- live guard allowed: `true`;
- live failures: `[]`.

These measured counters are below their current project halt thresholds.

### Free plan identity

The first organization usage attempt used Studio-internal `/platform` endpoints and failed remote authentication with `JWT could not be decoded`. No usage or billing conclusion is retained from that failed path.

PR `#1152` restricted evidence to PAT-compatible public Management API reads. Run `30785807617` proved:

- exact project identity;
- exact project-to-organization binding;
- organization plan `free`;
- Free plan confirmed.

Free-plan identity is not substituted for missing egress, usage-billing, or automatic-overage counters.

### Memory correction

PR `#1153` executed deterministic lifecycle sampling during six real steady ticks. Run `30785890154` retained `36` samples, but RSS, heap total, heap used, and external memory were zero for every sample.

Those values do **not** prove zero memory consumption or `200 MiB` of headroom. They mean that usable `Deno.memoryUsage()` counters were unavailable in the Supabase Edge runtime.

Issue `#1109` contains an explicit correction invalidating the zero-headroom interpretation.

PR `#1154` makes the correction enforceable:

- all-zero counters are classified as unavailable;
- memory min/p50/p95/max and headroom are not published as zero;
- lifecycle sampling remains recorded;
- memory measurement available: `false`;
- memory high-water qualified: `false`;
- memory fail-closed headroom proved: `false`;
- memory coverage not overstated: `true`;
- G7 remains qualified;
- G8 remains false;
- profile selection remains false.

## G8 unresolved requirements

The following requirements remain unresolved and block G8:

1. usable exact maximum-memory evidence, or a formally accepted alternative bound that is not described as a provider counter;
2. provider egress evidence, or a formal unavailable-counter disposition under the R4 contract;
3. usage-billing and automatic-overage evidence, or a formal hard-gate failure;
4. complete billing/no-charge qualification;
5. final reconciliation of every resource ceiling and fail-closed threshold.

No theoretical projection or all-zero runtime counter may be substituted for retained evidence.

## Next stage

Continue R4C2d only far enough to resolve the remaining G8 evidence or formally fail the profile.

After that:

1. revise the machine-readable R4B decision;
2. evaluate G1, G2, G9, and G10;
3. produce the R4E outcome: a fully qualified selected profile or `no_profile_qualified`.

R5 must not begin before that explicit decision.

## Retired production checkpoint

Controlling checkpoint: Issue `#1079`.

- network: `devnet`;
- Mainnet enabled: `false`;
- Worker Cron: empty;
- last completed slot: `2026-08-01T03:52:00Z`;
- failed slot: `2026-08-01T03:53:00Z`;
- failure: `Too many subrequests by single Worker invocation`;
- last processed ledger: `4,051,454`;
- latest observed ledger at halt: `4,108,194`;
- terminal lag: `56,740`;
- successor chain: halted;
- 24-hour soak: not started.

The halted Cloudflare deployment remains rollback context and historical evidence only.

## Operating restrictions

- Do not describe any isolated qualification surface as a public reader or production cutover.
- Do not describe G7 qualification as G8 qualification or Supabase selection.
- Do not describe R4C2c completion as R4 completion.
- Do not interpret all-zero memory counters as zero usage or headroom.
- Do not substitute Free-plan identity for egress or automatic-overage evidence.
- Do not restart the retired fixed-32-ledger runtime.
- Do not select a profile before all R4 hard gates pass.
- Do not add a payment method, paid plan, or automatic-overage profile.
- Do not use GitHub Actions as the normal collection clock.
- Do not start R5 recovery, stabilization, or soak early.
- Do not enable Mainnet.
- Do not switch the public reader.
- Do not skip a failed ledger or advance state after partial persistence.
- Do not silently fall back after integrity or identity failure.
