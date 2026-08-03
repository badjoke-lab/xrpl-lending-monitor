# Implementation status

Last updated: `2026-08-03`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The controlling engineering phase is `R4C2d`: Supabase Free Devnet resource qualification.

The retired Cloudflare fixed-32-ledger recovery remains halted. Worker Cron remains empty, Mainnet remains disabled, the legacy public reader remains authoritative, and no R5 recovery, stabilization qualification, or soak is active.

The Supabase Free Devnet profile remains **conditional and unselected** because G8 is unresolved.

## Current gate result

| Gate | Result | Controlling interpretation |
| --- | --- | --- |
| G1 no mandatory payment/card | **pass** | Exact organization is Free and requires no paid billing path |
| G2 no automatic paid overage | **pass** | Free-plan quota exhaustion produces notification, grace, and service restriction rather than paid overage |
| G3 durable scheduler and fault behavior | **pass** | Remote one-minute ownership, leases, retry, reclaim, duplicate convergence, successor reservation, and halt passed |
| G4 transactional completion and rollback | **pass** | Atomic completion, interruption rollback, and replay convergence passed |
| G5 committed-only reads and source-bound fences | **pass** | Remote committed-reader qualification passed |
| G6 export, restore, duplicate convergence, and continuation | **pass** | Complete-state and post-restore qualification passed |
| G7 sustained throughput | **pass** | Steady p95 `24/min` and catch-up p95 `14,178.400673920027/min` passed |
| G8 resource fail-closed | **unresolved** | Exact peak memory and provider egress remain unavailable |
| G9 operator independence | **pass** | Run `30789994825` bound all scripted operations to profile revision 2 |
| G10 production boundary | **pass** | Mainnet, public reader, recovery, stabilization, and soak remain unchanged |
| profile selected | `false` | No profile selection has occurred |

The current R4B result is:

- classification: `conditional_candidate`;
- selection: `not_selected`;
- eligible for scoring: `false`;
- passed gates: `9`;
- failed gates: `0`;
- unresolved gates: `G8`;
- decision digest: `e142f849d59d822da8e5fec5bea8f8dec600950e880b6e597b1971dfcd610b36`.

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

### R4C2d evidence

- normal-cadence/resource baseline: [`ops/r4c2d-supabase-throughput-resource-baseline-evidence-2026-08-03.md`](ops/r4c2d-supabase-throughput-resource-baseline-evidence-2026-08-03.md)
- isolated catch-up throughput: [`ops/r4c2d-supabase-isolated-catchup-throughput-evidence-2026-08-03.md`](ops/r4c2d-supabase-isolated-catchup-throughput-evidence-2026-08-03.md)
- network-inclusive steady throughput: [`ops/r4c2d-supabase-network-steady-throughput-evidence-2026-08-03.md`](ops/r4c2d-supabase-network-steady-throughput-evidence-2026-08-03.md)
- resource, no-charge, and operator evidence: [`ops/r4c2d-supabase-resource-headroom-evidence-2026-08-03.md`](ops/r4c2d-supabase-resource-headroom-evidence-2026-08-03.md)
- machine-readable gate state: [`ops/r4c2d-resource-gate-status-2026-08-03.json`](ops/r4c2d-resource-gate-status-2026-08-03.json)
- current R4B decision: [`ops/r4c2d-supabase-r4b-decision-2026-08-03.json`](ops/r4c2d-supabase-r4b-decision-2026-08-03.json)
- runtime invariants: [`history-runtime-contract.md`](history-runtime-contract.md)
- resource envelope: [`resource-envelope.md`](resource-envelope.md)

## Completed behavioral qualification

R4C2c retained:

- active seven-class execution and committed-reader semantics;
- `237` real historical Devnet rows across all seven semantic classes;
- historical pages `100 / 100 / 37` and `16` non-empty cross-class Loan relationship rows;
- one real `116`-row multi-chunk work with payload, commit, mutation, and reader parity `40 / 40 / 36`;
- exact collection, scheduler, publication, and maintenance export;
- typed restore with canonical text and SHA-256 parity;
- duplicate restore convergence and digest-tamper rejection;
- post-restore `scan -> commit -> finalize -> next scan` continuation;
- transaction interruption rollback;
- retry/backoff and stale-lease reclaim;
- terminal integrity halt with no invalid successor;
- duplicate phase and terminal replay convergence;
- active-profile isolation.

## G7 throughput qualification

The old one-phase-per-cron cadence retained p95 `1/min` and was rejected.

Run `30755497115` proved catch-up p95 `14,178.400673920027/min`, above the required `30/min`.

Run `30784402995` proved six consecutive network-inclusive minute buckets at `[24, 24, 24, 24, 24, 24]`, with exact 144-ledger target advance, attempt `1`, and active-source identity preservation. Steady p95 passed the required value above `21/min`.

**G7 is qualified.**

## G1 and G2 cost safety

Run `30785807617` proved exact project identity, exact project-to-organization binding, and organization plan `free` through PAT-compatible Management API reads.

Official Free-plan policy makes quota exhaustion a notification, grace, and service-restriction event rather than paid overage.

Therefore G1 and G2 pass. This does not prove provider egress and does not close G8.

## G8 measured resource state

Run `30779476979` proved pre-reservation fail-closed behavior for database storage, database connections, Edge wall time, stale external snapshot, projected invocations, and bundle size.

Run `30784402995` measured:

- active functions: `14`;
- one-day invocations: `3,717`;
- projected 31-day invocations: `115,227`;
- maximum CPU: `341 ms`;
- maximum observed average-memory bucket: `10.76615047454834 MB`;
- database size: `81,939,603` bytes;
- database connections: `10`;
- maximum Edge wall time: `5,202.7498 ms`;
- largest exact deployed bundle: `103,351` bytes;
- live guard allowed: `true`;
- live failures: `[]`.

### Memory boundary

Six steady ticks retained 36 lifecycle samples. RSS was zero for every sample while some heap or external counters were nonzero.

This means total-memory measurement is unavailable. It does not mean zero memory usage or 200 MiB headroom. Partial counters cannot substitute for RSS.

- memory measurement available: `false`;
- memory high-water qualified: `false`;
- memory headroom: unavailable;
- memory fail-closed headroom proved: `false`.

### Egress boundary

No retained PAT-compatible provider egress counter exists. Request counts, payload estimates, or Dashboard-only values are not accepted as provider egress evidence.

G8 therefore remains unresolved.

## G9 operator-independence qualification

PRs `#1157` and `#1158` added the exact revision-2 operator verifier and Issue publisher.

Remote run `30789994825`, commit `535bda53ad44ed1cfc0969ccf72c889e9254d124`, proved:

- exact profile revision and identity digest binding;
- scripted checkout, Supabase CLI setup, project link, migrations, and all function deployments;
- scripted one-run credential generation, masking, rotation, and project scoping;
- scripted checkpoint, export, restore, post-restore continuation, rollback, terminal halt, artifact upload, and Issue publication;
- repeatable restore through first empty-target restore or exact duplicate convergence;
- no routine Dashboard or interactive terminal requirement;
- active profile read-only behavior.

**G9 is qualified.** G8 remains false and the profile remains unselected.

## Next stage

Continue only the remaining R4 work:

1. obtain usable maximum-memory evidence or formally accept a clearly labelled non-provider alternative bound;
2. obtain provider egress evidence or formally fail G8 because the counter is unavailable;
3. regenerate R4B with G8 pass or fail;
4. produce the R4E outcome: `qualified_profile_selected` or `no_profile_qualified`.

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
- soak: not started.

## Operating restrictions

- Do not describe G7 or G9 qualification as G8 qualification or profile selection.
- Do not interpret zero RSS as zero total-memory usage or headroom.
- Do not substitute partial heap/external counters for RSS.
- Do not substitute Free-plan identity or request counts for provider egress evidence.
- Do not restart the retired fixed-32-ledger runtime.
- Do not select or score a profile before every hard gate is resolved.
- Do not add a payment method, paid plan, or debt-capable overage profile.
- Do not use GitHub Actions as the normal collection clock.
- Do not start R5 recovery, stabilization, or soak early.
- Do not enable Mainnet or switch the public reader.
- Do not skip a failed ledger, advance state after partial persistence, or silently fall back after an integrity failure.
