# R4 deployment-profile qualification plan — 2026-08-01

Status: controlling R4 contract, updated `2026-08-02` after completed Supabase R4C2c remote transfer, continuation, and fault qualification.

R0–R3, R4A, R4B, R4C1, R4C2a, R4C2b, and the planned R4C2c remote behavioral qualification are complete on `main`. The Supabase candidate now has retained remote proof for active and isolated normal phase execution, committed reads, all-seven-class and relationship data, standard multi-chunk work, exact complete-state transfer, post-restore continuation, interruption rollback, retry/backoff, exact-expiry stale-lease reclaim, duplicate convergence, and terminal fail-closed halt.

R4C2d throughput and Free-plan resource qualification is the next active stage. Supabase remains a conditional candidate and is not selected.

## Supporting evidence

- initial matrix: [`r4-initial-profile-matrix-2026-08-01.json`](r4-initial-profile-matrix-2026-08-01.json)
- R4B evaluator evidence: [`r4b-profile-qualification-evaluator-evidence-2026-08-01.md`](r4b-profile-qualification-evaluator-evidence-2026-08-01.md)
- R4C1 local SQLite evidence: [`r4c1-local-sqlite-service-evidence-2026-08-01.md`](r4c1-local-sqlite-service-evidence-2026-08-01.md)
- R4C2a Supabase probe evidence: [`r4c2-supabase-remote-probe-evidence-2026-08-02.md`](r4c2-supabase-remote-probe-evidence-2026-08-02.md)
- R4C2b phase-chain evidence: [`r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.md`](r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.md)
- R4C2c executor evidence: [`r4c2c-supabase-seven-class-remote-evidence-2026-08-02.md`](r4c2c-supabase-seven-class-remote-evidence-2026-08-02.md)
- R4C2c active reader evidence: [`r4c2c-supabase-committed-reader-evidence-2026-08-02.md`](r4c2c-supabase-committed-reader-evidence-2026-08-02.md)
- historical discovery: [`r4c2c-devnet-historical-witness-evidence-2026-08-02.md`](r4c2c-devnet-historical-witness-evidence-2026-08-02.md)
- historical remote evidence: [`r4c2c-supabase-historical-witness-remote-evidence-2026-08-02.md`](r4c2c-supabase-historical-witness-remote-evidence-2026-08-02.md)
- multi-chunk implementation plan: [`r4c2c-supabase-multichunk-witness-plan-2026-08-02.md`](r4c2c-supabase-multichunk-witness-plan-2026-08-02.md)
- durable-source correction: [`r4c2c-multichunk-durable-source-recovery-2026-08-02.md`](r4c2c-multichunk-durable-source-recovery-2026-08-02.md)
- multi-chunk remote evidence: [`r4c2c-supabase-multichunk-remote-evidence-2026-08-02.md`](r4c2c-supabase-multichunk-remote-evidence-2026-08-02.md)
- complete-state transfer evidence: [`r4c2c-supabase-complete-state-transfer-remote-evidence-2026-08-02.md`](r4c2c-supabase-complete-state-transfer-remote-evidence-2026-08-02.md)
- post-restore continuation evidence: [`r4c2c-supabase-restore-continuation-remote-evidence-2026-08-02.md`](r4c2c-supabase-restore-continuation-remote-evidence-2026-08-02.md)
- remote fault evidence: [`r4c2c-supabase-remote-fault-evidence-2026-08-02.md`](r4c2c-supabase-remote-fault-evidence-2026-08-02.md)

## Decision rule

No weighted score can override a hard gate.

A profile remains conditional or is rejected when it requires or cannot disprove:

- a payment method or mandatory paid subscription;
- automatic paid overage;
- an unreliable external scheduler as the normal collector clock;
- partial or non-transactional state advancement;
- incomplete export or restore;
- routine dashboard or terminal operation;
- public or production mutation before an explicit R5 gate.

R4 may conclude `no_profile_qualified`.

## Hard gates

### G1 — No mandatory payment or card

The normal profile must require no paid plan, payment method, card verification, prepaid credit, or billing path capable of creating debt.

### G2 — No automatic paid overage

Quota exhaustion must fail closed without a charge.

### G3 — Durable internal scheduler

Normal collection requires one-minute-or-finer continuation with exact identity, availability, leases, stale reclaim, retries, duplicate convergence, successor reservation, and terminal halt. GitHub Actions may deploy and verify but cannot own the normal clock.

R4C2a–R4C2c now retain Supabase evidence for one-minute `pg_cron`, durable phase messages, exact retry timing, exact-expiry reclaim, duplicate convergence, successor reservation after successful phases, and terminal halt without a successor. Final gate closure remains subject to R4B evidence rebinding.

### G4 — Transactional phase completion

Phase mutation, current-message completion, and successor reservation must share one atomic boundary or a formally equivalent proven protocol.

R4C2b proved normal atomic completion and successor reservation. R4C2c run `30752742177` proved an injected transaction abort removes the staged sentinel, synthetic successor, successor reservation, and completion update together.

### G5 — Committed-only reads

Uncommitted rows must never become public or shadow-authoritative. The profile must preserve finalization, read fences, source-bound cursors, and integrity fail-closed behavior.

R4C2c retains active and isolated committed-reader proof, immutable work fences, multi-page continuation, cursor tamper rejection, stale-fence rejection, and post-restore rows that remain unavailable until finalization.

### G6 — Exact complete-state transfer

The profile must export and empty-target restore collection, scheduler, publication, and maintenance state with exact canonical parity before restore commit.

Run `30750389833` proved exact canonical export and typed empty-target restore. Run `30751813536` proved controlled post-restore continuation through standard phases with exact committed-row parity and one pending successor scan.

### G7 — Throughput

Retained evidence must exceed:

- `21` committed ledgers/minute in steady p95 windows;
- `30` committed ledgers/minute during catch-up.

This gate remains unresolved and is the central R4C2d target.

### G8 — Resource fail-closed behavior

The profile must stop before request, query, write, CPU, memory, size, storage, bandwidth, connection, or concurrency ceilings without exposing rows, advancing watermarks, or reserving an invalid successor.

This gate remains unresolved at sustained Free-plan scale. R4C2d must measure the complete phase chain and prove stop thresholds before provider ceilings.

### G9 — Operator independence

Deploy, rollback, checkpoint, export, restore, evidence, halt, and credential rotation must be scriptable without routine dashboard or terminal operation.

The single guarded workflow now scripts migration, nine exact Edge deployments, one-run credential rotation, all remote verifiers, artifact upload, and the Issue #1109 locator. Final gate closure still requires R4B reconciliation of rollback, operational halt, and routine-operation boundaries.

### G10 — Production boundary

R4 cannot restart the retired Cloudflare collector, switch the public reader, enable Mainnet, start catch-up, start stabilization slots, or start soak.

All R4C2 evidence remains isolated or qualification-only. This gate remains enforced.

## Candidate classification

### Supabase Free Postgres plus pg_cron and Edge Functions

Current status: **remote-verified conditional candidate; not selected**.

#### R4C2a — Remote probe bootstrap

Run `30709474048` proved cardless project access, remote migration and Function deployment, one-minute `pg_cron`, transactional tick leases, repeated Devnet observation, and sanitized evidence.

#### R4C2b — Durable remote phase chain

Run `30726776731` proved deterministic remote scan, commit, finalize, watermark, and successor identities; durable pending, leased, and completed state; atomic phase completion and successor reservation; committed-only validated-ledger visibility; and four consecutive committed work items.

#### R4C2c — Active executor and reader

The qualification profile is `supabase-devnet` under epoch `supabase-r4c2c-v1`.

Retained runs prove:

- repeated remote phase execution with consecutive failures `0`;
- committed-only active reader;
- immutable fence and deterministic order;
- exact and ledger-range queries;
- cursor digest, query/order, source, and stale-fence rejection;
- bounded pagination;
- qualification credential and purpose rejection.

#### R4C2c — All-seven-class historical proof

The isolated historical profile atomically retains `237` real Devnet rows:

- validated-ledger: `3`;
- protocol-event: `13`;
- object-change: `197`;
- loan-lifecycle: `3`;
- archived-object: `1`;
- balance-history: `2`;
- current-projection: `18`.

Retained remote proof includes pages `100 / 100 / 37`, exact lookup for every class, semantic-count parity, a non-empty `16`-row Loan relationship, duplicate loader convergence, and cursor/source/fence/credential rejection.

#### R4C2c — Standard multi-chunk proof

Run `30747137075` completed one isolated `116`-row standard work under profile `supabase-devnet-multichunk-witness`.

Exact phase sequence, all at attempt `1`:

1. `scan`;
2. `commit:0` — `40` rows;
3. `commit:1` — `40` rows;
4. `commit:2` — `36` rows;
5. `finalize`.

Payload, commit, row mutation, and reader pages all retained `40 / 40 / 36` parity. The active watermark remained source-identical and isolated.

#### R4C2c — Complete-state transfer

Run `30750389833` proved:

- exact collection, scheduler, publication, and maintenance export;
- `300,890` canonical bytes;
- digest `fb9b7dda66802f18c18200b2991ff6293cd5b11b3dd04a91d5089524ea93dda2`;
- typed empty-target restore;
- exact 13 table-class counts;
- five completed and one pending scheduler message;
- canonical text and SHA-256 parity;
- duplicate restore convergence;
- digest-tamper rejection;
- active-profile isolation.

#### R4C2c — Post-restore continuation

Run `30751813536` proved:

- restored anchor ledger `4,132,573`;
- `scan -> commit -> finalize -> next scan`;
- restored committed ledger `4,132,574`;
- attempts `1 / 1 / 1 / 0`;
- exact committed-row count and full-row digest parity;
- duplicate replay convergence for scan, commit, and finalize;
- active watermark unchanged by the isolated verifier.

#### R4C2c — Remote fault qualification

Run `30752742177` proved:

- transaction-abort rollback of sentinel, synthetic successor, successor reservation, and completion;
- exact `30`-second retry/backoff with one-second pre-due rejection and attempt-2 completion;
- exact-expiry stale-lease reclaim with pre-expiry rejection, previous-owner evidence, and attempt-2 completion;
- terminal integrity failure producing message `error` and stream `halted`;
- no terminal successor reservation;
- ready halt-probe remaining pending and unclaimable;
- duplicate terminal replay convergence;
- missing-token and wrong-purpose rejection;
- active watermark unchanged at ledger `4,132,584` during the isolated verifier.

#### Remaining Supabase blockers

The planned R4C2c behavioral blockers are closed. Remaining blockers are:

- G7: sustained steady and catch-up throughput above fixed thresholds;
- G8: measured Free-plan resource headroom and fail-closed thresholds;
- G9: final operator-independence evidence reconciliation;
- G1/G2: final retained no-card and no-automatic-overage evidence reconciliation;
- R4B evaluator revision and R4E selection decision.

No completed remote proof authorizes selection by itself.

### Cardless self-hosted SQLite service

Current status: **conditional candidate; not selected**.

R4C1 proves local crash/reopen persistence, scheduler-state survival, exact-expiry process-lease reclaim, backoff, graceful stop, and terminal halt. G7, G8, and actual always-on G9 evidence remain unresolved.

### Turso Free plus cardless executor

Current status: **conditional candidate; not selected**.

Transaction, interruption, complete-state transfer, scheduler/executor ownership, and quota behavior remain unproven.

### Existing Cloudflare Workers/D1/Queues profile

Current status: **blocked**.

No payment method, billing mutation, remote deployment, or restart is permitted. Existing account and resource-limit blockers remain.

### Rejected profiles

- GitHub Actions-only collector: scheduled workflows cannot satisfy the durable internal clock and catch-up guarantees.
- Deno Deploy Free managed runtime: card verification and uptime constraints violate the current gates.

## R4B evaluator

The evaluator binds exactly one evidence record for each G1–G10 gate to a canonical profile identity and revision. It forbids scoring while any gate fails or remains unresolved and keeps selection at `not_selected` before R4E.

The next Supabase evaluator revision must incorporate all retained active, historical, relationship, multi-chunk, transfer, continuation, and fault evidence. It must not promote unresolved throughput, resource, cost, or operational gates.

## R4C2 schedule

### R4C2a — Remote probe bootstrap

Status: **complete**.

### R4C2b — Remote portable scheduler and phase chain

Status: **complete**.

### R4C2c — Seven-class remote collector and reader/transfer/fault parity

Status: **complete for the planned remote behavioral qualification**.

Completed remote evidence:

- shared seven-class normalization and deterministic identity;
- active phase-chain deployment and continuation;
- qualification-only active committed reader;
- exact active stream/work fence and cursor rejection;
- real all-seven-class historical set;
- exact duplicate historical convergence;
- non-empty relationship reads;
- three standard payload chunks and ordered commits;
- three-page single-work committed-reader continuation;
- exact complete-state export and typed empty-target restore;
- canonical text and digest parity;
- duplicate restore and digest-tamper rejection;
- controlled post-restore continuation;
- exact committed-row parity;
- interruption rollback;
- exact retry/backoff;
- exact-expiry stale-lease reclaim;
- duplicate phase and terminal replay convergence;
- terminal fail-closed halt;
- active-profile isolation.

### R4C2d — Throughput and resource qualification

Status: **active next stage**.

Required evidence:

- steady p95 above `21` committed ledgers/minute;
- catch-up above `30` committed ledgers/minute;
- end-to-end phase throughput including all commits and finalization;
- p50, p95, and maximum CPU and wall time;
- requests, queries, writes, rows, bytes, Function invocations, bandwidth, connections, concurrency, and storage growth;
- fail-closed project thresholds before Free-plan and provider ceilings;
- retained no-charge and no-automatic-overage evidence.

### R4C2e — R4B and R4E decision

Produce either:

- a fully gate-passing Supabase decision eligible for R4E selection; or
- a conditional/rejected decision with exact remaining blockers.

No schedule pressure can promote a conditional candidate.

## Later R4 stages

- R4C3: local or isolated libSQL/Turso-compatible harness only if still necessary after Supabase results.
- R4C4: local Cloudflare resource model only; the existing remote Cloudflare profile remains blocked.
- R4D: longer isolated shadow measurement after cost-safety gates remain proved.
- R4E: select one fully qualified profile or record `no_profile_qualified`.

## Production boundary

All Supabase executor, reader, historical, multi-chunk, transfer, continuation, and fault surfaces are qualification surfaces. They are not the retired production collector or public reader. The public reader remains legacy-authoritative.

R4 still forbids:

- public-reader cutover;
- Mainnet enablement;
- recovery declaration;
- lag-zero declaration;
- qualification slots;
- 24-hour or seven-day soak;
- removal of legacy rollback evidence.
