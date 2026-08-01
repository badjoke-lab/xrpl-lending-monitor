# R4 deployment-profile qualification plan — 2026-08-01

Status: controlling R4 contract. R0–R3 are complete on `main` through merge `78e221e17d41c2a8bc55d2b6898d4fc088cdb9d2`.

R4 is local and read-only. It selects no provider, creates no hosted resource, changes no billing state, deploys no collector, mutates no production data, changes no Queue or Cron, and keeps Mainnet disabled.

The machine-readable initial matrix is [`r4-initial-profile-matrix-2026-08-01.json`](r4-initial-profile-matrix-2026-08-01.json).

## Decision rule

No weighted score can override a hard gate.

A profile that is faster, easier, or operationally familiar is still rejected when it requires:

- a payment method or credit-card verification for normal operation;
- a mandatory paid subscription;
- automatic paid overage;
- an unreliable external scheduler as the normal collection clock;
- partial or non-transactional cursor advancement;
- incomplete export or restore;
- routine interactive dashboard or terminal operation;
- production mutation before R5.

R4 may conclude that **no available profile qualifies**. That outcome is preferable to restarting an unsafe or chargeable collector.

## Hard gates

### G1 — No mandatory payment or card

The complete normal operating profile must not require:

- a paid plan;
- a payment method;
- credit-card verification;
- prepaid credits;
- a billing profile that can create new debt.

A cardless storage service does not pass G1 when its scheduler or executor requires a card.

### G2 — No automatic paid overage

Quota exhaustion must fail closed. A profile fails when exceeding a request, compute, storage, bandwidth, or write quota can create a charge.

A paid plan with a configurable spend cap is not equivalent to a cardless zero-charge profile.

### G3 — Durable internal scheduler

The normal collector requires one-minute-or-finer internal continuation and durable message identity.

The scheduler must preserve:

- exact message identity;
- availability time;
- lease and stale reclaim;
- retry identity;
- phase completion and successor reservation;
- duplicate convergence;
- terminal halt with no successor.

GitHub Actions cannot own the normal collection clock. It remains limited to CI, immutable publication, evidence, and bounded repair workflows.

### G4 — Transactional phase completion

The selected profile must prove that phase mutation, current-message completion, and successor reservation share one atomic boundary or a formally equivalent transaction protocol.

No profile may emulate this contract with an unverified sequence of remote writes.

### G5 — Committed-only reads

Uncommitted candidate rows must never become public or shadow-authoritative.

The profile must preserve:

- atomic finalization;
- immutable committed read fences;
- exact source/query/order/fence cursor identity;
- no silent fallback after integrity failure.

### G6 — Exact complete-state transfer

The profile must export and restore the complete R3 state envelope:

- collection work and chunks;
- committed rows and collection watermark;
- scheduler messages and outbox;
- publication candidates and publication watermark;
- maintenance plans and mutations.

Restore must target an empty compatible store and prove exact canonical parity before commit.

### G7 — Throughput

Retained evidence must exceed:

- `21` committed ledgers per minute in steady p95 windows;
- `30` committed ledgers per minute during catch-up.

The test must include content-heavy ledgers, multiple commit chunks, publication separation, and resource accounting. Average throughput cannot hide a p95 failure.

### G8 — Resource fail-closed behavior

The profile must stop before provider or project ceilings for:

- requests and subrequests;
- database queries and writes;
- row reads and mutations;
- CPU and wall time;
- memory;
- message and row size;
- storage;
- bandwidth;
- connection or concurrency limits.

A halted phase must not expose rows, advance a collection or publication watermark, or reserve a successor when the failure is terminal.

### G9 — Operator independence

Normal operation must not depend on an operator repeatedly opening a dashboard or terminal.

The profile must provide scriptable and testable paths for:

- deployment;
- rollback;
- checkpoint;
- export;
- empty-target restore;
- resource evidence;
- halt evidence;
- credential rotation.

### G10 — Production boundary

R4 is qualification only.

It cannot:

- restart the retired collector;
- create a production scheduler;
- mutate production storage;
- switch the public reader;
- enable Mainnet;
- start catch-up, stabilization, qualification slots, or soak.

Those actions require a separately approved R5 profile and recovery plan.

## Initial profile classification

### Cardless self-hosted SQLite service — conditional candidate

This is the closest match to the proven reference semantics because SQLite, the durable scheduler, publication state, and complete-state transfer already pass locally.

It remains unqualified because no host has proved:

- continuous unattended operation;
- service supervision and restart;
- stable power and network;
- secure outbound XRPL connectivity;
- off-host immutable evidence retention;
- automated deploy and rollback;
- no routine terminal dependency;
- required steady and catch-up throughput.

R4 does not assume that an existing personal computer can become a production server.

### Supabase Free Postgres with pg_cron and Edge Functions — conditional candidate

Official documentation states that the Free plan is not charged, while paid plans require a card. Free projects can pause after low activity, and Free database and function ceilings remain material.

It remains unqualified until evidence proves:

- cardless organization and project creation;
- no automatic paid transition;
- exact scheduler ownership and message identity;
- one atomic phase/successor transaction;
- complete-state export and restore;
- XRPL WebSocket compatibility;
- an early project stop threshold before storage becomes read-only;
- no pause during normal operation and deterministic restart after provider pause;
- throughput and resource headroom.

R4 first uses a local Postgres-compatible harness. No hosted Supabase resource is required to test the adapter contract.

### Turso Free storage with a self-hosted executor — conditional candidate

Turso currently advertises a cardless Free start and quota exhaustion returns a blocked error rather than a charge. It supplies storage, not the complete scheduler and executor profile.

It remains unqualified until evidence proves:

- transaction semantics sufficient for phase completion and successor reservation;
- exact complete-state transfer;
- deterministic behavior under network interruption;
- quota headroom and fail-closed thresholds;
- active and archived database behavior;
- a cardless, unattended scheduler and executor that do not reintroduce G1 or G9 failure.

R4 first tests a local libSQL/Turso-compatible target. Cloud credentials are not required for the initial conformance harness.

### Existing Cloudflare Workers Free, D1, and Queues profile — blocked

This profile is not selected and cannot be remotely tested until account access and zero-additional-charge operation are independently proven.

Separate technical blockers remain:

- Workers Free CPU and subrequest ceilings;
- D1 per-invocation query and daily write limits;
- Queue retention and execution limits;
- complete-state adapter absence;
- prior production failure at a Worker subrequest ceiling.

R4 may build local adapter and resource models. It must not deploy, alter billing, add a payment method, or assume that an unpaid or restricted account can be used.

### GitHub Actions-only collector — rejected

Scheduled Actions have a five-minute minimum and can be delayed or dropped under load. They cannot satisfy the durable one-minute internal scheduler gate or the required freshness and catch-up guarantees.

Actions remain approved only for:

- CI;
- immutable publication;
- evidence retention;
- bounded manual repair;
- qualification orchestration that does not own the collection clock.

### Deno Deploy Free — rejected

Current Deno documentation states that organizations receive only restricted Free limits until they verify by linking a credit card. The current platform also has no uptime guarantee during public beta.

The managed Deno Deploy profile therefore fails G1 and G9 for this project. Self-hosted Deno is a separate local runtime option and is not evaluated as Deno Deploy Free.

## Qualification scorecard

Only profiles passing every hard gate receive a score.

Each passing profile is then scored from `0` to `5` for:

- cost-safety headroom;
- scheduler durability;
- transaction fidelity;
- resource headroom;
- complete-state portability;
- observability and evidence quality;
- deployment and rollback automation;
- operator independence;
- public-read integration safety;
- long-term maintenance burden.

The score is comparative evidence, not a substitute for a gate.

## R4 implementation sequence

### R4A — Contract and initial matrix

Status: active on branch `agent/r4-deployment-profile-qualification-contract`.

Deliverables:

- this contract;
- a machine-readable candidate matrix;
- explicit rejected, blocked, and conditional classifications;
- official evidence snapshot;
- R3 completion and R4 status updates;
- ordinary CI.

### R4B — Machine-readable evaluator

Implement provider-neutral types and a deterministic evaluator that:

- validates exact profile descriptors;
- records hard-gate evidence and unknowns;
- prevents scoring when one gate fails or remains unresolved;
- produces a canonical decision artifact;
- rejects unsupported evidence versions and changed profile identity;
- contains no provider credentials or SDK imports.

### R4C — Local profile harnesses

Build local, non-remote harnesses for:

1. self-hosted SQLite service management;
2. Postgres transaction and scheduler semantics;
3. libSQL/Turso-compatible transaction and transfer semantics;
4. Cloudflare Worker/D1/Queue resource modeling without deployment.

Every harness runs the same adapter, reader, publication, maintenance, and complete-state conformance suites where applicable.

### R4D — Read-only shadow measurement

A profile reaching this stage may use read-only or isolated credentials only after G1 and G2 are proved.

Required evidence:

- exact provider limits and account plan;
- no payment method requirement;
- no automatic overage;
- read-only XRPL and provider probes;
- measured latency, requests, CPU, memory, rows, writes, bytes, and storage;
- no production mutation;
- no public-reader change.

### R4E — Selection or no-qualified-profile decision

R4E must produce exactly one of:

- `qualified_profile_selected` with complete evidence and an explicit R5 recovery proposal; or
- `no_profile_qualified` with failed gates and next engineering actions.

A conditional candidate cannot be promoted by schedule pressure.

## Official evidence snapshot

Accessed `2026-08-01`:

- Cloudflare Workers limits: <https://developers.cloudflare.com/workers/platform/limits/>
- Cloudflare D1 limits: <https://developers.cloudflare.com/d1/platform/limits/>
- Cloudflare Queues limits: <https://developers.cloudflare.com/queues/platform/limits/>
- GitHub Actions scheduled workflows: <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule>
- Deno Deploy changelog and billing verification: <https://docs.deno.com/deploy/changelog/>
- Deno Deploy pricing and beta limits: <https://docs.deno.com/deploy/pricing_and_limits/>
- Supabase cost controls: <https://supabase.com/docs/guides/platform/cost-control>
- Supabase Free project pausing: <https://supabase.com/docs/guides/platform/free-project-pausing>
- Supabase Edge Function limits: <https://supabase.com/docs/guides/functions/limits>
- Turso pricing: <https://turso.tech/pricing>
- Turso quota behavior: <https://docs.turso.tech/help/usage-and-billing>
- Turso inactive Free database behavior: <https://docs.turso.tech/cli/group/unarchive>

Provider documentation is an input to qualification, not operating proof. Limits must be captured again at the start of any later shadow measurement because provider plans can change.

## R4A exit

R4A passes only when:

- no provider is selected;
- every candidate has a hard-gate state;
- rejected and blocked profiles cannot accidentally enter scoring;
- payment/card and automatic-overage gates are explicit;
- GitHub Actions remains excluded from the normal clock;
- production remains fail-closed;
- R3 is recorded complete on `main`;
- lint, type-check, complete unit suite, migrations, build, and browser smoke pass.
