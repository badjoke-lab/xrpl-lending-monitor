# R4 deployment-profile qualification plan — 2026-08-01

Status: controlling R4 contract. R0–R3, R4A, and R4B are complete on `main`. R4C1 implementation and validation passed in PR #1104 and are pending merge.

R4 is local and read-only. It selects no provider, creates no hosted resource, changes no billing state, deploys no collector, mutates no production data, changes no Queue or Cron, and keeps Mainnet disabled.

Supporting artifacts:

- initial matrix: [`r4-initial-profile-matrix-2026-08-01.json`](r4-initial-profile-matrix-2026-08-01.json)
- R4B evidence: [`r4b-profile-qualification-evaluator-evidence-2026-08-01.md`](r4b-profile-qualification-evaluator-evidence-2026-08-01.md)
- R4C1 local SQLite evidence: [`r4c1-local-sqlite-service-evidence-2026-08-01.md`](r4c1-local-sqlite-service-evidence-2026-08-01.md)

## Decision rule

No weighted score can override a hard gate.

A profile is rejected or remains conditional when it requires or cannot disprove:

- a payment method or credit-card verification;
- a mandatory paid subscription;
- automatic paid overage;
- an unreliable external scheduler as the normal collection clock;
- partial or non-transactional cursor advancement;
- incomplete export or restore;
- routine interactive dashboard or terminal operation;
- production mutation before R5.

R4 may conclude `no_profile_qualified`.

## Hard gates

### G1 — No mandatory payment or card

The complete normal profile must require no paid plan, payment method, card verification, prepaid credit, or billing profile capable of creating new debt.

### G2 — No automatic paid overage

Quota exhaustion must fail closed without a charge. A paid plan with a configurable cap does not satisfy this project’s cardless zero-charge requirement.

### G3 — Durable internal scheduler

Normal collection requires one-minute-or-finer continuation with exact message identity, availability, leases, stale reclaim, retries, atomic successor reservation, duplicate convergence, and terminal halt.

GitHub Actions cannot own the normal collection clock.

### G4 — Transactional phase completion

Phase mutation, current-message completion, and successor reservation must share one atomic boundary or a formally equivalent proven protocol.

### G5 — Committed-only reads

Uncommitted rows must never become public or shadow-authoritative. The profile must preserve atomic finalization, read fences, source-bound cursors, and integrity fail-closed behavior.

### G6 — Exact complete-state transfer

The profile must export and empty-target restore collection, scheduler, publication, and maintenance state with exact canonical parity before restore commit.

### G7 — Throughput

Retained evidence must exceed:

- `21` committed ledgers/minute in steady p95 windows;
- `30` committed ledgers/minute during catch-up.

### G8 — Resource fail-closed behavior

The profile must stop before request, query, write, CPU, memory, size, storage, bandwidth, connection, or concurrency ceilings without exposing rows, advancing watermarks, or reserving an invalid successor.

### G9 — Operator independence

Deploy, rollback, checkpoint, export, restore, evidence, halt, and credential-rotation paths must be scriptable and must not require routine dashboard or terminal operation.

### G10 — Production boundary

R4 cannot restart the retired collector, create a production scheduler, mutate production, switch the public reader, enable Mainnet, or start catch-up, stabilization, qualification slots, or soak.

## Initial profile classification

### Conditional candidates

- **Cardless self-hosted SQLite service** — closest to the proven reference semantics; R4C1 now proves local file-backed process and scheduler recovery, but throughput, full resource envelopes, and actual always-on operations remain unresolved.
- **Supabase Free Postgres plus pg_cron/Edge Functions** — cardless creation, exact atomic scheduler ownership, complete-state transfer, provider pausing, storage stop thresholds, WebSocket support, and throughput remain unproven.
- **Turso Free storage plus cardless self-hosted executor** — storage is cardless and quotas fail closed, but scheduler/executor, cross-service atomicity, network interruption, archive behavior, and complete-state transfer remain unproven.

### Blocked

- **Existing Cloudflare Workers/D1/Queues profile** — blocked until account access and zero-additional-charge operation are proved. No payment method, plan, billing mutation, or remote deployment is permitted. Separate CPU, subrequest, D1, Queue, transaction, and complete-state blockers remain.

### Rejected

- **GitHub Actions-only collector** — scheduled workflows cannot satisfy the normal durable internal clock and catch-up guarantees.
- **Deno Deploy Free managed runtime** — unrestricted Free use requires credit-card verification and the current beta has no uptime guarantee.

No profile is selected.

## Machine-readable evaluator

R4B is complete on `main` in PR #1103, merge `683c3b65fc31a2c8ffde289b1c607b94890219de`.

The evaluator provides:

- exact profile ID, revision, label, and component identity;
- canonical SHA-256 profile identity digest;
- exactly one profile-bound evidence record for each of `G1`–`G10`;
- deterministic rejected, conditional, or qualified classification;
- permanent `selection: not_selected` before R4E;
- scoring prohibition while any gate fails or remains unresolved;
- exact ten-dimension scorecards only after every gate passes;
- canonical decision artifacts and decision digests.

Final R4B CI run `30703646271` passed the complete ordinary CI suite.

## Qualification scorecard

Only a profile passing every hard gate can receive scores from `0` to `5` for:

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

Scoring does not select a profile. Selection belongs to R4E.

## R4C1 — Local service-managed SQLite harness

Status: **implementation and validation passed in PR #1104; merge pending**.

### Delivered

Migration `10008` and the local supervisor reference implementation prove:

- idempotent initialization;
- process generations;
- file-backed SQLite WAL and `synchronous = FULL` persistence;
- fresh process-lease theft rejection;
- exact-expiry stale process-lease reclaim after database close/reopen;
- scheduler state persistence across process restart;
- process lease and scheduler message lease separation;
- heartbeat persistence;
- retryable failure with explicit restart time;
- early restart rejection;
- graceful stop;
- terminal halt with no automatic restart;
- canonical event evidence.

The local process lease is intentionally host-local and is not transferred through the portable cross-host complete-state envelope.

### R4B result

The machine-readable R4C1 decision is:

- `conditional_candidate`;
- `not_selected`;
- ineligible for scoring;
- 7 gates passed;
- 0 gates failed;
- G7, G8, and G9 unresolved.

Local crash and scheduler recovery prove neither the throughput gate nor an always-on production host.

### Validation

Implementation and evidence head `0b9cf6b7f42aee4ac1fb93758d8c5cbfedff0f1a` passed CI run `30704517323`: workflow guard, lint, shell and canonical-base checks, type-check, production runner checks, complete unit suite, clean migrations through `10008`, build, and browser smoke.

## R4C2 — Local Postgres transaction and scheduler semantics

Status: **next after PR #1104 merges**.

R4C2 must prove locally, without a hosted Supabase project or credential:

- serializable or equivalent phase ownership;
- atomic work mutation, message completion, and successor reservation;
- deterministic message identity and availability;
- fresh-lease rejection and stale reclaim;
- retry and duplicate convergence;
- committed-only reads;
- publication and maintenance separation;
- complete-state export and empty-target restore;
- interruption rollback.

Postgres availability on CI or the local harness is an implementation detail, not provider qualification.

## Later R4 stages

### R4C3 — Local libSQL/Turso-compatible harness

Test transaction, interruption, complete-state, and quota-model behavior without cloud credentials.

### R4C4 — Local Cloudflare resource model

Model Workers, D1, and Queue ceilings without deployment or account mutation. The existing Cloudflare profile remains blocked regardless of a theoretical resource pass until zero-additional-charge operation is proved.

### R4D — Read-only shadow measurement

A profile reaches R4D only after G1 and G2 are proved. Required evidence includes exact plan and limits, no card/payment requirement, no automatic overage, isolated read-only probes, measured latency and resource usage, and no production or public-reader mutation.

### R4E — Selection or no-qualified-profile decision

R4E produces exactly one of:

- `qualified_profile_selected` with complete evidence and an explicit R5 proposal; or
- `no_profile_qualified` with failed gates and next engineering actions.

A conditional candidate cannot be promoted by schedule pressure.

## Official evidence snapshot

Accessed `2026-08-01`:

- Cloudflare Workers limits: <https://developers.cloudflare.com/workers/platform/limits/>
- Cloudflare D1 limits: <https://developers.cloudflare.com/d1/platform/limits/>
- Cloudflare Queues limits: <https://developers.cloudflare.com/queues/platform/limits/>
- GitHub Actions scheduled workflows: <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule>
- Deno Deploy billing verification: <https://docs.deno.com/deploy/changelog/>
- Deno Deploy beta limits: <https://docs.deno.com/deploy/pricing_and_limits/>
- Supabase cost controls: <https://supabase.com/docs/guides/platform/cost-control>
- Supabase Free project pausing: <https://supabase.com/docs/guides/platform/free-project-pausing>
- Supabase Edge Function limits: <https://supabase.com/docs/guides/functions/limits>
- Turso pricing: <https://turso.tech/pricing>
- Turso quota behavior: <https://docs.turso.tech/help/usage-and-billing>
- Turso inactive Free database behavior: <https://docs.turso.tech/cli/group/unarchive>

Provider documentation is qualification input, not operating proof. It must be captured again before any later shadow measurement.

## R4C1 exit

R4C1 passes only when:

- file-backed supervisor and scheduler state survive process reopen;
- fresh and stale leases behave exactly;
- retry, backoff, graceful stop, and terminal halt fail closed;
- the R4B decision remains conditional and unscored;
- no always-on host or production claim is made;
- no provider SDK, credential, payment, hosted resource, or remote mutation is introduced;
- production remains fail-closed;
- ordinary CI passes.
