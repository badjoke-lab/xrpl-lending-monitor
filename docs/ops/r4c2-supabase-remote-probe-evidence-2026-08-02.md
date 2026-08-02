# R4C2 Supabase remote probe evidence — 2026-08-02

Status: remote deployment and one-minute Devnet probe verified. This is not full collector qualification, profile selection, production recovery, or soak.

## Deployment evidence

GitHub Actions workflow run `30709474048` completed successfully on main commit `ca5c029311a3a50404eedb4ea3f7a0e5c2735c30`.

All steps passed:

- required GitHub Secret bindings;
- Supabase CLI setup;
- exact project linking;
- pending migration application;
- `xrpl-collector-tick` Edge Function deployment;
- repeated remote Cron verification;
- sanitized evidence upload.

Artifact:

- name: `supabase-remote-probe-evidence`;
- artifact ID: `8821390820`;
- digest: `sha256:8269161ecbc66f4acfa329402cb02cff2bade31c7de46f7611abe42014f64b32`;
- retention: seven days from creation.

Machine-readable retained evidence: [`r4c2-supabase-remote-probe-evidence-2026-08-02.json`](r4c2-supabase-remote-probe-evidence-2026-08-02.json).

## Verified remote state

Evidence timestamp: `2026-08-01T17:03:16.005Z`.

- service: `xrpl-lending-monitor-supabase-probe`;
- profile: `supabase-devnet`;
- network: `devnet`;
- health: `ok`;
- total completed ticks observed: `10`;
- consecutive failures: `0`;
- last error: `null`;
- latest completed tick: `2026-08-01T17:03:01.102Z`;
- latest validated ledger: `4,123,382`;
- latest validated ledger hash: `1DEDFD5F3A1074226E683988309B1D0A54F258881536891618AB9EB9A082F4C6`.

The five retained recent runs were all completed `pg_cron` executions at one-minute intervals. Their validated ledger indices were:

- `4,123,303`;
- `4,123,323`;
- `4,123,343`;
- `4,123,362`;
- `4,123,382`.

The remote verifier required at least two completed ticks, at least two successful Cron runs, Devnet identity, profile `supabase-devnet`, and zero consecutive failures. It passed on the first verification attempt.

## Runtime status interpretation

The retained runtime status is `stopped` because the lease is released after each short Cron tick. It does not mean the one-minute schedule is disabled. The repeated completed `pg_cron` runs prove that the remote schedule was active at the evidence timestamp.

## What this proves

R4C2 now has remote operating proof for:

- cardless Supabase Free project access;
- unattended GitHub-driven migration and Function deployment;
- Vault-backed Cron authentication;
- one-minute `pg_cron` invocation;
- Edge Function execution;
- transactional short-lived lease acquisition and release;
- repeated Devnet validated-ledger observation;
- sanitized remote evidence generation without secret disclosure.

## What this does not prove

This probe does not yet run the complete portable collector state machine. It does not prove:

- all seven semantic history classes on Supabase;
- exact scan, commit, and finalize successor semantics remotely;
- committed-only public reads from Supabase;
- full collection, scheduler, publication, and maintenance state export/restore on Supabase;
- throughput above the R4 G7 thresholds;
- sustained Free-plan resource headroom and stop thresholds;
- long-duration unattended reliability;
- public reader cutover;
- production recovery;
- Mainnet operation;
- qualification slots or soak.

## Current decision

The Supabase profile is a remotely verified conditional candidate. It remains unselected and ineligible for final R4 qualification until the unresolved hard gates are closed.

Next work:

1. remote transaction and durable scheduler conformance for the portable phase chain;
2. remote committed-reader and complete-state transfer parity;
3. bounded throughput and resource measurement;
4. explicit R4B evidence update;
5. R4E selection or `no_profile_qualified` decision.
