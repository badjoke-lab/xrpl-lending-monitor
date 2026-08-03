# R4 deployment-profile qualification plan — 2026-08-01

Status: controlling R4 contract, updated `2026-08-03` after the final Supabase revision-2 G8 disposition and R4E outcome.

R0–R3, R4A, R4B revision 2, R4C1, R4C2a–R4C2d, and R4E revision 2 are complete. Supabase revision 2 passed G1–G7, G9, and G10 but failed G8. It is rejected and unselected. R4E records `no_profile_qualified`.

The next phase is `R4C3`: qualify a distinct Supabase revision-3 profile with conservative application-owned resource accounting. R5 remains prohibited.

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

Unavailable required evidence is not a pass. A profile with a failed hard gate is rejected. R4 may conclude `no_profile_qualified` and may define a new profile revision only when its identity and evidence boundary are explicit.

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

The profile must export and restore collection, scheduler, publication, and maintenance state with exact canonical parity before restore commit and must continue from the restored state.

### G7 — Throughput

Retained evidence must exceed:

- `21` committed ledgers/minute in steady p95 windows;
- `30` committed ledgers/minute during catch-up.

### G8 — Resource fail-closed behavior

The profile must stop before request, query, write, CPU, memory, size, storage, bandwidth, connection, concurrency, invocation, or billing ceilings without exposing rows, advancing watermarks, or reserving an invalid successor.

A profile may use provider counters, exact runtime counters, or a formally defined conservative application-owned accounting boundary. It must not describe unavailable provider counters as measured. Any alternative boundary must over-account every covered resource, be enforced before mutation, and pass remote threshold-injection tests.

### G9 — Operator independence

Deploy, rollback, checkpoint, export, restore, evidence, halt, and credential rotation must be scriptable without routine dashboard or terminal operation.

### G10 — Production boundary

R4 cannot restart the retired Cloudflare collector, switch the public reader, enable Mainnet, start recovery catch-up, start stabilization slots, or start soak.

## Supabase revision 2 — final result

Profile:

- ID: `supabase_free_postgres_pgcron_edge`;
- revision: `2`;
- identity digest: `c42edf0a1708fd2b7ea9f2e72dab32b87c1d66b260752efe38fec321253d3998`.

### Retained behavioral qualification

Revision 2 proved:

- cardless Free project access and exact project-to-organization binding;
- one-minute internal `pg_cron` ownership;
- durable phase leases, retries, reclaim, successor state, and terminal halt;
- active seven-class execution and committed-only reader behavior;
- `237` real historical rows across all seven classes;
- one real `116`-row multi-chunk work with `40 / 40 / 36` parity;
- exact collection, scheduler, publication, and maintenance export;
- typed restore with canonical text and SHA-256 parity;
- duplicate restore convergence and digest-tamper rejection;
- post-restore continuation;
- transaction-abort rollback;
- active-profile isolation;
- scripted deploy, credential rotation, checkpoint, restore, rollback, halt, and evidence publication.

### G7 throughput result

The old one-phase-per-cron design failed at p95 `1/min` and was not promoted.

The revised measured design passed:

- steady minute rates: `[24, 24, 24, 24, 24, 24]`;
- steady p95: `24/min`, above `21/min`;
- catch-up p95: `14,178.400673920027/min`, above `30/min`.

G7: `pass`.

### G8 final disposition

Remote run `30800402654`, commit `db82291a7df3e8d4dfa458891e0a714f7d8d346b`, produced:

- G8 status: `fail`;
- disposition: `reject_profile`;
- profile selected: `false`.

Failure reasons:

- `provider_exact_peak_memory_unavailable`;
- `provider_egress_bytes_unavailable`;
- `runtime_total_memory_counter_unavailable`;
- `memory_headroom_not_qualified`.

The following passing components remain retained but do not override G8:

- database size `81,939,603` bytes below the 400,000,000-byte halt;
- database connections `10` below the 45-connection halt;
- Edge wall maximum `5,202.7498 ms` below the 45,000-ms halt;
- projected 31-day invocations `115,227` below the 400,000 halt;
- largest bundle `103,351` bytes below the 4,000,000-byte halt;
- maximum CPU `341 ms` below the runtime hard limit;
- exact Free-plan and no-paid-overage evidence;
- six injected fail-closed resource paths.

Memory and egress interpretations are fixed:

- zero RSS is not zero memory usage;
- partial heap or external counters cannot substitute for total memory;
- average memory cannot substitute for exact peak memory;
- generic project process metrics cannot substitute for function-scoped Edge memory;
- request counts and projections cannot substitute for provider egress bytes.

### Final R4B and R4E

R4B revision-2 decision:

- classification: `rejected`;
- passed / failed / unresolved: `9 / 1 / 0`;
- failed gate: `G8`;
- decision digest: `d1577a896e3f4e512a362586ae30990aceb5142f0783feb529626fa6f035e111`.

R4E outcome:

- outcome: `no_profile_qualified`;
- selected profile: `null`;
- R5 authorized: `false`;
- outcome digest: `c04d75c38c103b9549351ca92a8dab113e754e7e2ed720b93a17f58ff138bacb`.

## Other candidates

### Cardless self-hosted SQLite service

Status: **conditional and unselected**. Local persistence and fault semantics are proved, but always-on hosting, G7, G8, and G9 remain incomplete.

### Turso Free plus cardless executor

Status: **conditional and unselected**. Transaction, executor ownership, transfer, throughput, quota, and no-charge behavior remain insufficiently proved.

### Existing Cloudflare Workers/D1/Queues profile

Status: **blocked**. The retired fixed-32 runtime remains halted. No payment method, billing mutation, remote restart, or production recovery is permitted.

### Rejected profiles

- GitHub Actions-only collector: fails durable internal-clock requirements.
- Deno Deploy Free managed runtime: card and uptime constraints conflict with the gates.
- Supabase Free Postgres plus pg_cron and Edge Functions revision 2: failed G8.

## R4C3 — Supabase revision-3 alternative-bound qualification

Revision 3 must be a new profile identity. It may reuse proven revision-2 behavioral components only when each retained artifact is explicitly rebound to the new identity or rerun.

### Required resource-accounting contract

Before implementation, revision 3 must define machine-readable limits for:

- maximum ledgers and XRPL requests per tick;
- maximum XRPL response bytes per ledger and per tick;
- maximum normalized records and canonical JSON bytes per ledger and per tick;
- maximum in-memory ledgers, transactions, metadata nodes, candidates, payload chunks, and relationships;
- maximum database statements, rows, payload bytes, and transaction wall time;
- maximum function invocations per day and 31 days;
- maximum application-attributed ingress and egress bytes per day and 31 days;
- storage growth per committed ledger and retained-history horizon.

Every bound must include an explicit safety margin and a provider hard ceiling or a stricter project ceiling.

### Required enforcement

The executor must:

1. reject oversized XRPL responses while streaming or immediately after bounded read;
2. reject any ledger or tick whose accounted bytes or object counts exceed a bound;
3. halt before phase or successor mutation when projected monthly usage reaches a project ceiling;
4. record exact accounted values and conservative upper bounds in the same commit identity;
5. preserve committed-only reads and active-source isolation;
6. never call an unavailable provider counter a measured value.

### Required remote fault proof

For every revision-3 threshold, injected qualification must prove:

- zero committed works;
- zero watermark advancement;
- zero publication exposure;
- zero invalid successor reservation;
- released or terminally halted ownership as specified;
- exact active-profile identity preservation;
- repeatable evidence publication.

### R4C3 exit

R4C3 exits only when:

- the revision-3 identity digest is fixed;
- every G1–G10 evidence record is bound to revision 3;
- the exact evaluator returns `qualified_candidate`;
- a separate explicit selection record chooses revision 3;
- R5 authorization changes from `false` to `true` only in that selection record.

## Production boundary

Until R4C3 exits, the following remain forbidden:

- public-reader cutover;
- Mainnet enablement;
- recovery or lag-zero declaration;
- stabilization qualification;
- 24-hour or seven-day soak;
- restart of the retired Cloudflare collector;
- removal of legacy rollback evidence.
