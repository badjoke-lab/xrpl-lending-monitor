# R4 deployment-profile qualification plan — 2026-08-01

Status: controlling R4 contract, updated `2026-08-02` after verified Supabase Free remote probe evidence.

R0–R3, R4A, R4B, and R4C1 are complete on `main`. R4C2 has verified remote deployment and one-minute Devnet probe execution, but the Supabase profile is not yet fully qualified or selected.

Supporting artifacts:

- initial matrix: [`r4-initial-profile-matrix-2026-08-01.json`](r4-initial-profile-matrix-2026-08-01.json)
- R4B evaluator evidence: [`r4b-profile-qualification-evaluator-evidence-2026-08-01.md`](r4b-profile-qualification-evaluator-evidence-2026-08-01.md)
- R4C1 local SQLite evidence: [`r4c1-local-sqlite-service-evidence-2026-08-01.md`](r4c1-local-sqlite-service-evidence-2026-08-01.md)
- R4C2 Supabase evidence: [`r4c2-supabase-remote-probe-evidence-2026-08-02.md`](r4c2-supabase-remote-probe-evidence-2026-08-02.md)
- R4C2 machine-readable evidence: [`r4c2-supabase-remote-probe-evidence-2026-08-02.json`](r4c2-supabase-remote-probe-evidence-2026-08-02.json)

## Decision rule

No weighted score can override a hard gate.

A profile is rejected or remains conditional when it requires or cannot disprove:

- a payment method or card verification;
- a mandatory paid subscription;
- automatic paid overage;
- an unreliable external scheduler as the normal collector clock;
- partial or non-transactional state advancement;
- incomplete export or restore;
- routine dashboard or terminal operation;
- public or production mutation before an explicit R5 gate.

R4 may conclude `no_profile_qualified`.

## Hard gates

### G1 — No mandatory payment or card

The complete normal profile must require no paid plan, payment method, card verification, prepaid credit, or billing path capable of creating new debt.

### G2 — No automatic paid overage

Quota exhaustion must fail closed without a charge.

### G3 — Durable internal scheduler

Normal collection requires one-minute-or-finer continuation with exact identity, availability, leases, stale reclaim, retries, duplicate convergence, successor reservation, and terminal halt.

GitHub Actions may deploy and verify but cannot own the normal collector clock.

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

## Current candidate classification

### Supabase Free Postgres plus pg_cron and Edge Functions

Current status: **remotely verified conditional candidate; not selected**.

Verified by workflow run `30709474048` on main commit `ca5c029311a3a50404eedb4ea3f7a0e5c2735c30`:

- cardless project creation completed;
- GitHub production integration completed;
- Vault secrets registered;
- migration applied remotely;
- Edge Function deployed remotely;
- one-minute `pg_cron` schedule executed repeatedly;
- short-lived transactional lease completed and released;
- Devnet ledger observation completed repeatedly;
- sanitized evidence uploaded without secret disclosure.

Retained state at `2026-08-01T17:03:16.005Z`:

- tick count: `10`;
- recent Cron runs: `5/5 completed`;
- consecutive failures: `0`;
- latest Devnet ledger: `4,123,382`;
- last error: `null`.

This closes the initial uncertainty around project creation, remote deployment, one-minute scheduling, and unattended redeployment. It does not close the complete R4 profile gates.

Remaining Supabase blockers:

- G3: prove the full portable scheduler identity, retry, stale reclaim, and successor chain remotely;
- G4: prove atomic scan/commit/finalize phase completion remotely;
- G5: prove committed-only reader semantics and cursor fences remotely;
- G6: prove exact complete-state export and empty-target restore remotely;
- G7: measure sustained steady and catch-up throughput;
- G8: measure Free-plan resource headroom and fail-closed thresholds;
- G9: prove scripted rollback, export, restore, halt, and credential rotation without dashboard use.

G1, G2, and G10 remain subject to retained evidence and later R4B re-evaluation; the current remote probe alone does not authorize a final pass or selection.

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

- GitHub Actions-only collector: scheduled workflows cannot satisfy the normal durable internal clock and catch-up guarantees.
- Deno Deploy Free managed runtime: card verification and uptime constraints violate the current project gates.

## R4B evaluator

The evaluator binds exactly one evidence record for each G1–G10 gate to a canonical profile identity and revision. It forbids scoring while any gate fails or remains unresolved and keeps selection at `not_selected` before R4E.

The next Supabase evaluator revision must use the retained remote artifact and must not upgrade unresolved complete-collector gates based on the probe alone.

## R4C2 schedule

### R4C2a — Remote probe bootstrap

Status: **complete**.

Delivered:

- Supabase migration and schema;
- Vault-backed Cron authentication;
- one-minute `pg_cron` invocation;
- Devnet ledger Edge Function;
- short-lived transactional lease RPCs;
- sanitized health endpoint;
- unattended GitHub deploy and verification workflow;
- retained remote evidence.

### R4C2b — Remote portable scheduler and phase chain

Status: **next**.

Required evidence:

- durable exact message identity;
- pending, leased, completed, retry, and terminal states;
- fresh-lease rejection and stale reclaim;
- atomic work mutation, message completion, and successor reservation;
- duplicate convergence;
- interruption rollback;
- scan → commit → finalize → next scan continuation.

### R4C2c — Remote reader and complete-state parity

Required evidence:

- committed-only visibility;
- immutable read fences;
- source/query/order-bound cursors;
- all seven semantic classes;
- exact collection, scheduler, publication, and maintenance export;
- empty-target restore with canonical parity;
- post-restore continuation.

### R4C2d — Throughput and resource qualification

Required evidence:

- steady p95 above `21` committed ledgers/minute;
- catch-up above `30` committed ledgers/minute;
- CPU, memory, database, Function invocation, bandwidth, and connection measurements;
- explicit fail-closed stop thresholds before Free-plan ceilings;
- retained no-charge evidence.

### R4C2e — R4B and R4E decision

Produce either:

- a fully gate-passing Supabase decision eligible for scoring and R4E selection; or
- a conditional/rejected decision with exact remaining blockers.

No schedule pressure can promote a conditional candidate.

## Later R4 stages

- R4C3: local or isolated libSQL/Turso-compatible harness if still necessary after Supabase results.
- R4C4: local Cloudflare resource model only; existing remote Cloudflare profile remains blocked.
- R4D: longer read-only or isolated shadow measurement after cost-safety gates remain proved.
- R4E: select one fully qualified profile or record `no_profile_qualified`.

## Production boundary

The Supabase remote probe is not the retired production collector and is not the full portable collector.

R4 still forbids:

- public-reader cutover;
- Mainnet enablement;
- recovery declaration;
- lag-zero declaration;
- qualification slots;
- 24-hour or seven-day soak;
- removal of legacy rollback evidence.
