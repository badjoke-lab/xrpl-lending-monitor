# R4 deployment-profile qualification plan — 2026-08-01

Status: controlling R4 contract, updated `2026-08-02` after verified Supabase R4C2c standard-phase multi-chunk execution and committed-reader continuation.

R0–R3, R4A, R4B, R4C1, R4C2a, and R4C2b are complete on `main`. R4C2c now has retained remote proof for the active phase chain and reader, non-empty all-seven-class and relationship reads in an isolated historical profile, and true three-chunk standard-phase execution plus three-page committed-reader continuation in an isolated multi-chunk profile. Exact remote complete-state transfer and remote fault qualification remain active. The Supabase profile remains conditional and unselected.

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
- machine-readable multi-chunk evidence: [`r4c2c-supabase-multichunk-remote-evidence-2026-08-02.json`](r4c2c-supabase-multichunk-remote-evidence-2026-08-02.json)

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

### G4 — Transactional phase completion

Phase mutation, current-message completion, and successor reservation must share one atomic boundary or a formally equivalent proven protocol.

### G5 — Committed-only reads

Uncommitted rows must never become public or shadow-authoritative. The profile must preserve finalization, read fences, source-bound cursors, and integrity fail-closed behavior.

### G6 — Exact complete-state transfer

The profile must export and empty-target restore collection, scheduler, publication, and maintenance state with exact canonical parity before restore commit.

### G7 — Throughput

Retained evidence must exceed:

- `21` committed ledgers/minute in steady p95 windows;
- `30` committed ledgers/minute during catch-up.

### G8 — Resource fail-closed behavior

The profile must stop before request, query, write, CPU, memory, size, storage, bandwidth, connection, or concurrency ceilings without exposing rows, advancing watermarks, or reserving an invalid successor.

### G9 — Operator independence

Deploy, rollback, checkpoint, export, restore, evidence, halt, and credential rotation must be scriptable without routine dashboard or terminal operation.

### G10 — Production boundary

R4 cannot restart the retired Cloudflare collector, switch the public reader, enable Mainnet, start catch-up, start stabilization slots, or start soak.

## Candidate classification

### Supabase Free Postgres plus pg_cron and Edge Functions

Current status: **remote-verified conditional candidate; not selected**.

#### R4C2a

Run `30709474048` proved cardless project access, remote migration and function deployment, one-minute `pg_cron`, transactional tick leases, repeated Devnet observation, and sanitized evidence.

#### R4C2b

Run `30726776731` proved deterministic remote scan, commit, finalize, watermark, and successor identities; durable pending, leased, and completed state; atomic phase completion and successor reservation; committed-only validated-ledger visibility; and four consecutive committed work items.

This closes the initial normal-success-path portions of G3 and G4 for one validated-ledger work per scan. It does not close fault behavior for the full collector.

#### R4C2c active executor and reader

The active profile is `supabase-devnet` under epoch `supabase-r4c2c-v1`.

Run `30747137075` reverified:

- completed ticks: `914`;
- consecutive failures: `0`;
- watermark ledger: `4,132,531`;
- collector verifier attempt: `1`;
- reader verifier attempt: `1`.

The active reader retains immutable-fence, deterministic order, exact, range, cursor tamper, query/order mismatch, cross-source, stale-fence, and bounded-page proof for active committed data.

#### R4C2c all-seven-class historical proof

The isolated historical profile atomically retains `237` real Devnet rows across all seven semantic classes.

Retained remote proof includes:

- pages `100 / 100 / 37`;
- exact lookup for every class;
- semantic-count parity;
- a non-empty `16`-row Loan relationship query;
- exact duplicate loader convergence;
- cursor, source, fence, credential, and purpose rejection.

The durable committed set is now authoritative for qualification replay when the external Devnet endpoint prunes those old ledgers.

#### R4C2c standard multi-chunk proof

Run `30747137075` on main commit `3f1d8b43e0100edba61f3016cd67d3f162d48be0` completed one isolated standard-phase work.

Profile and work:

- profile: `supabase-devnet-multichunk-witness`;
- epoch: `supabase-r4c2c-v1`;
- base identity: `multichunk-witness-2776760`;
- source ledger: `2,776,760`;
- source rows: `116`;
- work ID: `collector-work-v1:devnet:supabase-r4c2c-v1:multichunk-witness-2776760:2776760:E7E4E253C314D5EBD39E8C063415A99299E48FB23A0E613F1FE5CA534B0C0628`.

Exact completed sequence, all on attempt `1`:

1. `scan`;
2. `commit:0` — `40` rows;
3. `commit:1` — `40` rows;
4. `commit:2` — `36` rows;
5. `finalize`.

Remote parity:

- payload rows: `40 / 40 / 36`;
- commit operations: `40 / 40 / 36`;
- row mutations: `40 / 40 / 36`;
- committed rows: `116`;
- reader pages: `40 / 40 / 36`;
- unique reader rows: `116`;
- exact lookup: passed;
- semantic-count parity: passed;
- immutable work-fence continuation: passed;
- cursor and credential rejection: passed.

The active watermark remained at ledger `4,132,531` with the same hash and work ID before and after the isolated work. The isolated work ID never entered the active profile.

This closes retained true multi-chunk standard-phase execution and one-work multi-page committed-reader continuation for an isolated remote qualification profile. It does not by itself select or cut over that profile.

#### Remaining Supabase blockers

- G3: remote retry/backoff, stale-lease reclaim, duplicate phase replay, and terminal halt evidence for the qualification profile;
- G4: remote interruption rollback evidence;
- G6: exact remote complete-state export, empty-target restore, canonical parity, and post-restore continuation;
- G7: sustained steady and catch-up throughput above fixed thresholds;
- G8: measured Free-plan resource headroom and fail-closed thresholds;
- G9: scripted rollback, export, restore, halt, and credential rotation evidence without routine dashboard use.

G1, G2, and G10 remain subject to retained evidence and later R4B re-evaluation. No remote proof authorizes final selection by itself.

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

The next Supabase evaluator revision must incorporate all retained active, historical, relationship, and multi-chunk evidence without promoting unresolved transfer, fault, throughput, resource, or operational gates.

## R4C2 schedule

### R4C2a — Remote probe bootstrap

Status: **complete**.

### R4C2b — Remote portable scheduler and phase chain

Status: **complete**.

### R4C2c — Seven-class remote collector and reader/transfer parity

Status: **active; all-seven-class, relationship, and standard multi-chunk phase/reader proof complete in isolated qualification profiles; transfer and fault evidence incomplete**.

Completed remote evidence:

- shared seven-class normalization and deterministic identity;
- active phase-chain deployment and continuation;
- qualification-only active committed reader;
- exact active stream/work fence and cursor rejection;
- real all-seven-class historical set;
- exact duplicate historical convergence;
- non-empty relationship reads;
- three standard payload chunks;
- three ordered standard commit chunks;
- standard finalize after all chunks;
- three-page single-work committed-reader continuation;
- active-watermark isolation.

Required remaining evidence:

- exact collection, scheduler, publication, and maintenance export;
- empty-target restore with canonical parity;
- post-restore continuation;
- remote retry and backoff;
- stale-lease reclaim;
- duplicate phase replay;
- interruption rollback;
- terminal injection and fail-closed halt.

### R4C2d — Throughput and resource qualification

Status: **blocked on remaining R4C2c transfer and fault evidence**.

Required evidence:

- steady p95 above `21` committed ledgers/minute;
- catch-up above `30` committed ledgers/minute;
- CPU, memory, database, Function invocation, bandwidth, and connection measurements;
- fail-closed stop thresholds before Free-plan ceilings;
- retained no-charge evidence.

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

The Supabase active executor and reader, isolated historical loader and reader, and isolated multi-chunk executor and reader are qualification surfaces, not the retired production collector or public reader. The public reader remains legacy-authoritative.

R4 still forbids:

- public-reader cutover;
- Mainnet enablement;
- recovery declaration;
- lag-zero declaration;
- qualification slots;
- 24-hour or seven-day soak;
- removal of legacy rollback evidence.
