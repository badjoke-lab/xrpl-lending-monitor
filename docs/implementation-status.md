# Implementation status

Last updated: `2026-08-03`.

## Current phase

XRPL Lending Monitor is **not formally released**.

Supabase profile revision 2 completed R4 qualification and was **rejected**. The controlling engineering phase is now `R4C3`: qualify a Supabase revision-3 resource boundary based on conservative application-owned accounting and fail-closed pre-reservation limits.

The retired Cloudflare fixed-32-ledger recovery remains halted. Worker Cron remains empty, Mainnet remains disabled, the legacy public reader remains authoritative, and no R5 recovery, stabilization qualification, or soak is active.

No deployment profile is selected.

## Revision-2 final gate result

| Gate | Result | Controlling interpretation |
| --- | --- | --- |
| G1 no mandatory payment/card | **pass** | Exact organization is Free and requires no paid billing path |
| G2 no automatic paid overage | **pass** | Free-plan quota exhaustion produces restriction rather than paid overage |
| G3 durable scheduler and fault behavior | **pass** | One-minute ownership, leases, retry, reclaim, duplicate convergence, successor reservation, and halt passed |
| G4 transactional completion and rollback | **pass** | Atomic completion, interruption rollback, and replay convergence passed |
| G5 committed-only reads and source-bound fences | **pass** | Remote committed-reader qualification passed |
| G6 export, restore, duplicate convergence, and continuation | **pass** | Complete-state and post-restore qualification passed |
| G7 sustained throughput | **pass** | Steady p95 `24/min` and catch-up p95 `14,178.400673920027/min` passed |
| G8 resource fail-closed | **fail** | Required exact peak-memory, provider egress, total-memory counter, and memory-headroom evidence is unavailable |
| G9 operator independence | **pass** | Run `30789994825` bound scripted operations to revision 2 |
| G10 production boundary | **pass** | Mainnet, public reader, recovery, stabilization, and soak remained unchanged |
| profile selected | `false` | Revision 2 was rejected and no replacement is qualified |

Remote run `30800402654`, commit `db82291a7df3e8d4dfa458891e0a714f7d8d346b`, produced the final G8 disposition:

- G8 status: `fail`;
- disposition: `reject_profile`;
- failure reasons:
  - `provider_exact_peak_memory_unavailable`;
  - `provider_egress_bytes_unavailable`;
  - `runtime_total_memory_counter_unavailable`;
  - `memory_headroom_not_qualified`.

The final revision-2 R4B result is:

- classification: `rejected`;
- selection: `not_selected`;
- eligible for scoring: `false`;
- passed gates: `9`;
- failed gates: `1`;
- unresolved gates: `0`;
- failed gate: `G8`;
- decision digest: `d1577a896e3f4e512a362586ae30990aceb5142f0783feb529626fa6f035e111`.

R4E records:

- outcome: `no_profile_qualified`;
- selected profile: `null`;
- R5 authorized: `false`;
- outcome digest: `c04d75c38c103b9549351ca92a8dab113e754e7e2ed720b93a17f58ff138bacb`.

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

### R4C2d and R4E evidence

- normal-cadence/resource baseline: [`ops/r4c2d-supabase-throughput-resource-baseline-evidence-2026-08-03.md`](ops/r4c2d-supabase-throughput-resource-baseline-evidence-2026-08-03.md)
- isolated catch-up throughput: [`ops/r4c2d-supabase-isolated-catchup-throughput-evidence-2026-08-03.md`](ops/r4c2d-supabase-isolated-catchup-throughput-evidence-2026-08-03.md)
- network-inclusive steady throughput: [`ops/r4c2d-supabase-network-steady-throughput-evidence-2026-08-03.md`](ops/r4c2d-supabase-network-steady-throughput-evidence-2026-08-03.md)
- resource, no-charge, operator, and final disposition evidence: [`ops/r4c2d-supabase-resource-headroom-evidence-2026-08-03.md`](ops/r4c2d-supabase-resource-headroom-evidence-2026-08-03.md)
- machine-readable gate state: [`ops/r4c2d-resource-gate-status-2026-08-03.json`](ops/r4c2d-resource-gate-status-2026-08-03.json)
- rejected revision-2 R4B decision: [`ops/r4c2d-supabase-r4b-decision-2026-08-03.json`](ops/r4c2d-supabase-r4b-decision-2026-08-03.json)
- R4E outcome: [`ops/r4e-deployment-profile-outcome-2026-08-03.json`](ops/r4e-deployment-profile-outcome-2026-08-03.json)
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

G7 remains qualified for the measured design.

## G8 failure boundary

Measured database, connection, wall-time, invocation, bundle, CPU, and cost-safety values were below their retained thresholds. Those passing components did not close the two unavailable resource surfaces.

Six steady ticks retained `36` lifecycle memory samples. Zero RSS does not mean zero total-memory usage, and partial heap or external counters cannot substitute for RSS. The provider probe also exposed no PAT-compatible egress-byte field. A generic project process-memory metric is not function-scoped peak Edge memory.

Revision 2 therefore fails G8 and is rejected.

## Current next stage — R4C3

Revision 3 must not relabel missing provider counters as measured evidence. It must instead define a different profile identity whose hard boundary is explicitly application-owned and conservative.

Required R4C3 work:

1. define revision-3 identity and exact resource-accounting contract;
2. account for every XRPL response byte, emitted payload byte, database request, function invocation, and bounded in-memory object before mutation;
3. use fixed upper bounds and pre-reservation halts where runtime counters are unavailable;
4. prove threshold injection leaves no work, watermark, publication, or successor mutation;
5. rerun G1–G10 against revision 3;
6. select the profile only after every gate passes;
7. begin R5 only after explicit selection.

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

- Do not describe passing G7 or G9 as G8 qualification.
- Do not interpret zero RSS as zero total-memory usage or headroom.
- Do not substitute partial heap/external counters for RSS.
- Do not substitute generic project memory metrics for function-scoped peak memory.
- Do not substitute Free-plan identity, request counts, or projections for provider egress evidence.
- Do not restart the retired fixed-32-ledger runtime.
- Do not select or score a profile before every hard gate passes.
- Do not add a payment method, paid plan, or debt-capable overage profile.
- Do not use GitHub Actions as the normal collection clock.
- Do not start R5 recovery, stabilization, or soak early.
- Do not enable Mainnet or switch the public reader.
- Do not skip a failed ledger, advance state after partial persistence, or silently fall back after an integrity failure.
