# R4 deployment-profile qualification plan — 2026-08-01

Status: controlling R4 contract, updated `2026-08-03` after network-inclusive steady throughput qualification.

R0–R3, R4A, R4B, R4C1, R4C2a, R4C2b, and the planned R4C2c remote behavioral qualification are complete on `main`. R4C2d has qualified G7 throughput for the measured Supabase design. G8 resource and no-charge qualification remains incomplete. Supabase remains conditional and unselected.

## Decision rule

No weighted score can override a hard gate.

A profile remains conditional or is rejected when it requires or cannot disprove:

- a payment method or mandatory paid subscription;
- automatic paid overage;
- an unreliable external scheduler as the normal collector clock;
- partial or non-transactional state advancement;
- incomplete export or restore;
- routine dashboard or terminal operation;
- insufficient steady or catch-up throughput;
- unbounded provider-resource or billing exposure;
- public or production mutation before an explicit R5 gate.

R4 may conclude `no_profile_qualified`.

## Hard gates

### G1 — No mandatory payment or card

The normal profile must require no paid plan, payment method, card verification, prepaid credit, or billing path capable of creating debt.

### G2 — No automatic paid overage

Quota exhaustion must fail closed without a charge.

### G3 — Durable internal scheduler

Normal collection requires one-minute-or-finer continuation with exact identity, availability, leases, stale reclaim, retries, duplicate convergence, successor reservation, and terminal halt. GitHub Actions may deploy and verify but cannot own the normal clock.

### G4 — Transactional phase completion

Phase mutation, current-message completion, and successor reservation must share one atomic boundary or a formally equivalent proven protocol.

### G5 — Committed-only reads

Uncommitted rows must never become public or shadow-authoritative. Finalization, immutable read fences, source-bound cursors, and integrity fail-closed behavior are mandatory.

### G6 — Exact complete-state transfer

The profile must export and empty-target restore collection, scheduler, publication, and maintenance state with exact canonical parity before restore commit and must continue from the restored state.

### G7 — Throughput

Retained evidence must exceed:

- `21` committed ledgers/minute in steady p95 windows;
- `30` committed ledgers/minute during catch-up.

### G8 — Resource fail-closed behavior

The profile must stop before request, query, write, CPU, memory, size, storage, bandwidth, connection, concurrency, invocation, or billing ceilings without exposing rows, advancing watermarks, or reserving an invalid successor.

### G9 — Operator independence

Deploy, rollback, checkpoint, export, restore, evidence, halt, and credential rotation must be scriptable without routine dashboard or terminal operation.

### G10 — Production boundary

R4 cannot restart the retired Cloudflare collector, switch the public reader, enable Mainnet, start recovery catch-up, start stabilization slots, or start soak.

## Supabase candidate

Current status: **remote-verified conditional candidate; not selected**.

### R4C2a–R4C2c

Retained evidence now covers:

- cardless project access and remote deployment;
- one-minute internal `pg_cron` ownership;
- durable phase leases and successor state;
- active seven-class execution and committed-only reader behavior;
- exact source-bound cursor and stale-fence rejection;
- `237` real historical rows across all seven classes;
- non-empty cross-class Loan relationship reads;
- exact duplicate historical persistence;
- one real `116`-row standard multi-chunk work with `40 / 40 / 36` payload, commit, mutation, and reader parity;
- exact collection, scheduler, publication, and maintenance export;
- typed empty-target restore with canonical text and SHA-256 parity;
- duplicate restore convergence and digest-tamper rejection;
- post-restore continuation;
- transaction-abort rollback;
- retry/backoff and exact-expiry stale-lease reclaim;
- terminal integrity halt with no invalid successor;
- duplicate phase and terminal replay convergence;
- active-profile isolation.

The planned R4C2c remote behavioral qualification is complete. This does not select the profile.

### R4C2d G7 throughput

#### Baseline that failed

Run `30754437078`, attempt `2`, measured the old one-phase-per-cron active cadence:

- 60-minute p95: `1/min`;
- six-hour p95: `1/min`;
- 24-hour p95: `1/min`;
- complete work p95: approximately `120.5 seconds`.

That cadence failed and was not promoted.

#### Catch-up component

Run `30755497115` executed five isolated trials of 64 real committed works:

- minimum: `12,563.651375831556/min`;
- p50: `13,975.162925561042/min`;
- p95: `14,178.400673920027/min`;
- maximum: `14,225.868101463015/min`;
- exact full-phase, successor, committed-row digest, and target-watermark parity;
- active source read only.

The catch-up component passed `>30/min`.

#### Network-inclusive steady component

Run `30756935523` used internal Supabase `pg_cron` and a dedicated isolated target profile. Six consecutive minute buckets each:

- fetched 24 exact expanded Devnet ledgers;
- verified parent-hash continuity;
- used the existing Lending parser and seven-class normalizer;
- atomically committed scan, payload, row, commit, finalize, successor, and watermark state;
- completed under the 50-second cron HTTP limit;
- preserved the active source epoch and base identity.

Observed minute rates were `[24, 24, 24, 24, 24, 24]`.

- steady minimum/p50/p95/max: `24 / 24 / 24 / 24` ledgers/minute;
- steady component: passed `>21/min`;
- retained catch-up component: passed `>30/min`;
- **G7: qualified**.

Controlling evidence:

- [`r4c2d-supabase-throughput-resource-baseline-evidence-2026-08-03.md`](r4c2d-supabase-throughput-resource-baseline-evidence-2026-08-03.md)
- [`r4c2d-supabase-isolated-catchup-throughput-evidence-2026-08-03.md`](r4c2d-supabase-isolated-catchup-throughput-evidence-2026-08-03.md)
- [`r4c2d-supabase-network-steady-throughput-evidence-2026-08-03.md`](r4c2d-supabase-network-steady-throughput-evidence-2026-08-03.md)

### R4C2d G8 resource qualification

Status: **incomplete**.

Existing retained measurements include:

- database size and table sizes;
- row counts;
- payload and scheduler-message byte distributions;
- database connection usage;
- XRPL fetch time;
- normalization time;
- complete Edge wall time;
- atomic database transaction time.

Required remaining evidence:

1. Edge CPU usage for single-phase, catch-up, and 24-ledger steady executions;
2. Edge memory usage and bounded peak behavior;
3. Function invocation counts and sustained quota use;
4. bandwidth and egress;
5. storage growth under the 24-ledger steady design;
6. provider-visible quota counters;
7. cardless/no-charge and automatic-overage behavior;
8. explicit pre-ceiling thresholds;
9. a remote fault test proving each threshold halts before mutation, watermark advancement, publication, or invalid successor reservation.

G8 cannot be closed using theoretical projections alone.

## Other candidates

### Cardless self-hosted SQLite service

Status: **conditional and unselected**.

Local persistence, process leases, retry/backoff, graceful stop, terminal halt, and complete-state behavior are proved. G7, G8, and always-on G9 evidence are not complete for this profile.

### Turso Free plus cardless executor

Status: **conditional and unselected**.

Transaction, interruption, scheduler/executor ownership, transfer, throughput, quota, and no-charge behavior remain insufficiently proved.

### Existing Cloudflare Workers/D1/Queues profile

Status: **blocked**.

The retired fixed-32 runtime remains halted. No payment method, billing mutation, remote restart, or production recovery is permitted.

### Rejected profiles

- GitHub Actions-only collector: cannot satisfy the durable internal clock and catch-up guarantees.
- Deno Deploy Free managed runtime: card and uptime constraints conflict with current gates.

## R4C2e and R4E

After G8 evidence exists:

1. revise the machine-readable R4B evidence;
2. bind exactly one current evidence record to every G1–G10 gate;
3. produce either `qualified_profile_selected` or `no_profile_qualified`;
4. retain the decision and exact remaining blockers;
5. keep selection `not_selected` until every hard gate passes.

## Production boundary

R4 still forbids:

- public-reader cutover;
- Mainnet enablement;
- recovery declaration;
- lag-zero declaration;
- stabilization qualification;
- 24-hour or seven-day soak;
- removal of legacy rollback evidence.

G7 qualification does not authorize R5. G8 and final R4B/R4E selection must complete first.
