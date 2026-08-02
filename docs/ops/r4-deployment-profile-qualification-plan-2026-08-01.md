# R4 deployment-profile qualification plan — 2026-08-01

Status: controlling R4 contract, updated `2026-08-02` after verified Supabase R4C2c seven-class executor deployment.

R0–R3, R4A, R4B, R4C1, R4C2a, and R4C2b are complete on `main`. The R4C2c remote executor is deployed and its schema-3 verifier passed, but non-empty remote evidence for six semantic classes, reader/transfer parity, and remote fault qualification remain active. The Supabase profile remains conditional and unselected.

Supporting artifacts:

- initial matrix: [`r4-initial-profile-matrix-2026-08-01.json`](r4-initial-profile-matrix-2026-08-01.json)
- R4B evaluator evidence: [`r4b-profile-qualification-evaluator-evidence-2026-08-01.md`](r4b-profile-qualification-evaluator-evidence-2026-08-01.md)
- R4C1 local SQLite evidence: [`r4c1-local-sqlite-service-evidence-2026-08-01.md`](r4c1-local-sqlite-service-evidence-2026-08-01.md)
- R4C2a Supabase probe evidence: [`r4c2-supabase-remote-probe-evidence-2026-08-02.md`](r4c2-supabase-remote-probe-evidence-2026-08-02.md)
- R4C2b phase-chain evidence: [`r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.md`](r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.md)
- R4C2b machine-readable evidence: [`r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.json`](r4c2b-supabase-remote-phase-chain-evidence-2026-08-02.json)
- R4C2c remote deployment evidence: [`r4c2c-supabase-seven-class-remote-evidence-2026-08-02.md`](r4c2c-supabase-seven-class-remote-evidence-2026-08-02.md)
- R4C2c machine-readable evidence: [`r4c2c-supabase-seven-class-remote-evidence-2026-08-02.json`](r4c2c-supabase-seven-class-remote-evidence-2026-08-02.json)

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

#### R4C2a proof

Workflow run `30709474048` proved:

- cardless project creation;
- GitHub production integration;
- Vault secret registration;
- remote migration and Edge Function deployment;
- repeated one-minute `pg_cron` execution;
- short-lived transactional tick leases;
- repeated Devnet ledger observation;
- sanitized evidence upload.

#### R4C2b proof

Workflow run `30726776731` on main commit `c6446d8c5f336665e1f873c34c30556ec0c907bd` proved:

- deterministic remote scan, commit, and finalize identities;
- durable pending, leased, completed, and successor state;
- one phase execution per one-minute Cron tick;
- exact next-ledger parent-hash validation;
- payload digest and byte-count validation;
- scan completion and commit-message reservation in one transaction;
- commit evidence and finalize-message reservation in one transaction;
- finalize, committed watermark advancement, and next-scan reservation in one transaction;
- committed-only visibility for the validated-ledger class;
- four consecutive committed work items;
- no terminal phase message in retained evidence;
- continued next-scan availability.

Retained phase evidence:

- immutable base ledger: `4,132,391`;
- committed ledgers: `4,132,392`–`4,132,395`;
- watermark ledger: `4,132,395`;
- watermark hash: `63B0C8EDE770DCA9591E9147CA036821AC5197B8AC2403A394D8C1AA8F9D9454`;
- completed ticks: `504`;
- recent Cron runs: `5/5 completed`;
- consecutive failures: `0`;
- last error: `null`;
- latest successor: `scan / pending / attempt 0`.

This closes the normal-success-path portions of G3 and G4 for one validated-ledger work item per scan. It also supplies committed-only evidence for one class under G5. It does not complete those gates for the full collector.

#### R4C2c remote deployment proof

Workflow run `30735822415` on main commit `fa275a6372cd8d9ee3a486b5e65b530ffc421eb1` proved that the exact seven-class executor dependency graph can be bundled and deployed without Cloudflare runtime leakage.

Retained bundle evidence:

- bytes: `103,351`;
- SHA-256: `e7e4b58f5a841c3f5dd85cc024235f8f33b0db8a49d4956c00b056a4385139f8`;
- unresolved relative imports: `0`;
- Cloudflare runtime imports: `0`;
- `Deno.serve` entrypoint: present.

Retained phase evidence:

- verifier schema: `3`;
- phase epoch: `supabase-r4c2c-v1`;
- immutable base ledger: `4,132,417`;
- immutable base hash: `C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77`;
- committed watermark ledger: `4,132,418`;
- committed watermark hash: `F19EAD766B2B052513A08A0131F40B41E77C6DA273CE9C775ECC380E2FB02072`;
- completed ticks: `573`;
- consecutive failures at the evidence fence: `0`;
- last error: `null`;
- latest successor: `scan / pending / attempt 0`.

The deployed executor and verifier bind all seven semantic classes and passed ordered commit, committed-only visibility, semantic-count parity, and successor-continuation checks. The retained ledger had no Lending transaction, so committed counts were:

- validated-ledger: `1`;
- protocol-event: `0`;
- object-change: `0`;
- loan-lifecycle: `0`;
- archived-object: `0`;
- balance-history: `0`;
- current-projection: `0`.

This proves the seven-class envelope and zero-count parity, not non-empty persistence or identity/relationship preservation for six classes.

Two immediately earlier Cron runs failed during activation with `base_mismatch: scan message scope is not R4C2b Devnet`. The narrow recovery reached the new epoch and the verifier later passed. The retained scan completed at attempt `241`; commit and finalize each completed at attempt `1`. These facts remain transition evidence and do not satisfy clean retry, stale reclaim, interruption, duplicate, or terminal-injection qualification.

Remaining Supabase blockers:

- G3: remote injected stale-lease reclaim, retry, duplicate replay, and terminal-halt evidence across the full collector;
- G4: remote interruption rollback and atomicity evidence for all semantic classes and true multi-chunk work;
- G5: non-empty committed-only evidence for six classes plus immutable read fences and source/query/order-bound cursors;
- G6: exact complete-state export and empty-target restore of collection, scheduler, publication, and maintenance state;
- G7: sustained steady and catch-up throughput above the fixed thresholds;
- G8: measured Free-plan resource headroom and fail-closed stop thresholds;
- G9: scripted rollback, export, restore, halt, and credential rotation evidence without dashboard use.

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

- GitHub Actions-only collector: scheduled workflows cannot satisfy the normal durable internal clock and catch-up guarantees.
- Deno Deploy Free managed runtime: card verification and uptime constraints violate the current project gates.

## R4B evaluator

The evaluator binds exactly one evidence record for each G1–G10 gate to a canonical profile identity and revision. It forbids scoring while any gate fails or remains unresolved and keeps selection at `not_selected` before R4E.

The next Supabase evaluator revision must incorporate R4C2a, R4C2b, and R4C2c artifacts without promoting unresolved full-collector gates.

## R4C2 schedule

### R4C2a — Remote probe bootstrap

Status: **complete**.

### R4C2b — Remote portable scheduler and phase chain

Status: **complete**.

Delivered and remotely verified:

- exact durable phase identities;
- pending, leased, completed, retry-capable, and terminal-capable schema;
- stale-reclaim claim path;
- atomic successor reservation;
- payload and commit evidence;
- scan → commit → finalize → next scan continuation;
- committed watermark;
- committed-only validated-ledger visibility;
- unattended verification and retained run locator.

### R4C2c — Seven-class remote collector and reader/transfer parity

Status: **active; remote executor deployed and verifier passed, remaining evidence incomplete**.

Delivered and remotely verified:

- shared seven-class normalization and deterministic candidate identity;
- complete seven-class count envelope;
- deterministic payload construction and commit ordering;
- remote deployment of the exact portable executor bundle;
- zero unresolved relative imports;
- zero Cloudflare runtime imports;
- ordered scan, commit, finalize, watermark, and successor execution;
- committed-only visibility and semantic-count parity for the retained work;
- explicit R4C2b epoch supersession.

Required remaining evidence:

- non-empty real Devnet data for protocol events, object changes, loan lifecycle, archived objects, balance history, and current projections;
- class-complete identity and relationship preservation;
- true multi-chunk phase continuation;
- immutable read fences;
- source/query/order-bound cursors;
- exact collection, scheduler, publication, and maintenance export;
- empty-target restore with canonical parity;
- post-restore continuation;
- remote retry, stale reclaim, duplicate, interruption, and terminal injection evidence.

### R4C2d — Throughput and resource qualification

Status: **blocked on R4C2c completion**.

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

- R4C3: local or isolated libSQL/Turso-compatible harness only if still necessary after Supabase results.
- R4C4: local Cloudflare resource model only; the existing remote Cloudflare profile remains blocked.
- R4D: longer isolated shadow measurement after cost-safety gates remain proved.
- R4E: select one fully qualified profile or record `no_profile_qualified`.

## Production boundary

The Supabase R4C2c executor is not the retired production collector and is not yet a fully qualified seven-class profile. The public reader remains legacy-authoritative.

R4 still forbids:

- public-reader cutover;
- Mainnet enablement;
- recovery declaration;
- lag-zero declaration;
- qualification slots;
- 24-hour or seven-day soak;
- removal of legacy rollback evidence.
