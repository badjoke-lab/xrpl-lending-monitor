# Implementation status

Last updated: `2026-08-03`.

## Current phase

XRPL Lending Monitor is **not formally released**.

The controlling engineering phase is `R4C2d`: Supabase Free Devnet throughput and resource qualification.

The retired Cloudflare fixed-32-ledger recovery remains halted. Worker Cron remains empty, Mainnet remains disabled, the legacy public reader remains authoritative, and no R5 recovery, stabilization qualification, or soak is active.

The Supabase Free Devnet profile remains **conditional and unselected**.

## Current gate result

| Gate | Result | Controlling interpretation |
| --- | --- | --- |
| G1 no mandatory payment/card | **pass** | Exact organization is Free and requires no paid billing path |
| G2 no automatic paid overage | **pass** | Official Free-plan policy uses notification, grace, and service restriction instead of paid overage |
| G3 durable scheduler and fault behavior | **pass** | Remote isolated qualification passed |
| G4 transactional completion and rollback | **pass** | Remote rollback and exact completion passed |
| G5 committed-only reads and source-bound fences | **pass** | Remote committed-reader qualification passed |
| G6 export, restore, duplicate convergence, and continuation | **pass** | Complete-state and post-restore qualification passed |
| G7 sustained throughput | **pass** | Steady and catch-up components both passed |
| G8 resource fail-closed | **unresolved** | Exact peak memory and provider egress remain unavailable |
| G9 operator independence | **unresolved** | Complete retained rollback and unattended-operation evidence is not bound to revision 2 |
| G10 production boundary | **pass** | Mainnet, public reader, recovery, stabilization, and soak remain unchanged |
| profile selected | `false` | No profile selection has occurred |

The current R4B result is `conditional_candidate`, `not_selected`, with 8 passed gates and unresolved gates `G8` and `G9`.

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

### R4C2d throughput, resource, and decision evidence

- normal-cadence/resource baseline: [`ops/r4c2d-supabase-throughput-resource-baseline-evidence-2026-08-03.md`](ops/r4c2d-supabase-throughput-resource-baseline-evidence-2026-08-03.md)
- isolated catch-up throughput: [`ops/r4c2d-supabase-isolated-catchup-throughput-evidence-2026-08-03.md`](ops/r4c2d-supabase-isolated-catchup-throughput-evidence-2026-08-03.md)
- network-inclusive steady throughput: [`ops/r4c2d-supabase-network-steady-throughput-evidence-2026-08-03.md`](ops/r4c2d-supabase-network-steady-throughput-evidence-2026-08-03.md)
- resource and no-charge evidence: [`ops/r4c2d-supabase-resource-headroom-evidence-2026-08-03.md`](ops/r4c2d-supabase-resource-headroom-evidence-2026-08-03.md)
- machine-readable resource gate state: [`ops/r4c2d-resource-gate-status-2026-08-03.json`](ops/r4c2d-resource-gate-status-2026-08-03.json)
- current R4B decision: [`ops/r4c2d-supabase-r4b-decision-2026-08-03.json`](ops/r4c2d-supabase-r4b-decision-2026-08-03.json)
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

The rejected old one-phase-per-cron cadence retained p95 `1/min` and was not promoted.

Run `30755497115` proved catch-up p95 `14,178.400673920027/min`, above the required `30/min`, with exact committed-row, digest, watermark, and active-source parity.

Run `30784402995` proved the network-inclusive steady component:

- six consecutive completed minute buckets;
- minute rates: `[24, 24, 24, 24, 24, 24]`;
- p50/p95/max: `24 / 24 / 24` ledgers/minute;
- exact isolated target advance: `144` ledgers;
- all completed attempts: `1`;
- active source epoch and base identity preserved;
- active source remained read only.

Steady p95 passed the required value above `21/min`. Combined with the catch-up pass, **G7 is qualified**.

## G1 and G2 cost safety

PR `#1152` restricted account evidence to PAT-compatible public Management API reads. Run `30785807617` proved:

- exact project identity;
- exact project-to-organization binding;
- organization plan `free`.

Supabase's official policy states that Free-plan quota exhaustion is handled through notification, grace period, and service restriction rather than paid overage. Spend Cap configuration belongs to paid plans and is not required to make the Free plan no-charge.

Therefore:

- G1 no mandatory payment/card: `pass`;
- G2 no automatic paid overage: `pass`;
- billing/no-charge qualification: `pass`.

This does not prove provider egress consumption and does not close G8.

## G8 measured resource state

### Fail-closed guard behavior

PR `#1145` and remote run `30779476979` proved exact injected pre-reservation halts for database storage, database connections, Edge wall time, stale external snapshot, projected invocations, and bundle size. Each failure preserved active source identity and reserved no tick, work, message, or successor.

### Official function statistics

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

### Memory capability corrections

PR `#1153` executed deterministic lifecycle sampling during six real steady ticks. Run `30785890154` retained `36` samples and published RSS high water `0` for every tick. That did **not** prove zero memory consumption or `200 MiB` of headroom. Issue `#1109` contains the first correction.

PR `#1154` added capability reconciliation, but remote run `30786950713` exposed a second defect: partial heap or external counters were nonzero while RSS remained zero. The first reconciler incorrectly allowed those partial counters to qualify total memory.

PR `#1156` corrects the controlling rule:

- total-memory qualification requires at least one positive RSS sample;
- partial heap or external counters are retained but never substitute for RSS;
- zero RSS is not interpreted as zero total-memory usage;
- memory min/p50/p95/max and headroom remain unavailable;
- memory measurement available: `false`;
- memory high-water qualified: `false`;
- memory fail-closed headroom proved: `false`;
- memory coverage not overstated: `true`;
- G7 remains qualified;
- G8 remains false;
- profile selection remains false.

### G8 unresolved requirements

Only these resource blockers remain for G8:

1. usable exact maximum-memory evidence, or a formally accepted alternative bound that is not described as a provider counter;
2. provider egress evidence, or a formal R4 determination that unavailable egress counters make the profile fail G8;
3. final reconciliation of every measured ceiling and unavailable provider surface.

No theoretical projection, request count, payload-size estimate, average-memory value, zero RSS value, or partial heap counter may be substituted for retained provider evidence.

## G9 unresolved requirement

Deployment, migrations, verifier-token rotation, qualification, export, restore, and evidence publication are scripted.

G9 remains unresolved because complete retained evidence for:

- rollback of the exact profile revision;
- unattended recovery from deployment failure;
- operator-independent checkpoint and rollback execution;
- exact post-rollback source and state parity

has not yet been bound to revision 2.

## Current R4B decision

The current machine-readable decision has:

- profile revision: `2`;
- identity digest: `c42edf0a1708fd2b7ea9f2e72dab32b87c1d66b260752efe38fec321253d3998`;
- classification: `conditional_candidate`;
- selection: `not_selected`;
- eligible for scoring: `false`;
- passed gates: `8`;
- failed gates: `0`;
- unresolved gates: `G8`, `G9`;
- decision digest: `407f37226dc47663c7f980a8a1b3c04ed09a03a97add950f1d061db61ba5b897`.

## Next stage

Continue only the remaining R4 qualification work:

1. resolve or formally fail G8 memory and egress;
2. execute and retain G9 rollback/operator-independence qualification;
3. regenerate R4B with no unresolved gates or an explicit failure;
4. produce the R4E outcome: a fully qualified selected profile or `no_profile_qualified`.

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
- Do not interpret zero RSS as zero total-memory usage or headroom.
- Do not substitute partial heap or external counters for RSS.
- Do not substitute Free-plan identity for provider egress evidence.
- Do not restart the retired fixed-32-ledger runtime.
- Do not select or score a profile before all R4 hard gates pass.
- Do not add a payment method, paid plan, or debt-capable overage profile.
- Do not use GitHub Actions as the normal collection clock.
- Do not start R5 recovery, stabilization, or soak early.
- Do not enable Mainnet.
- Do not switch the public reader.
- Do not skip a failed ledger or advance state after partial persistence.
- Do not silently fall back after integrity or identity failure.
