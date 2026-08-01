# Supabase one-time setup — 2026-08-02

This is the only dashboard setup required before Supabase becomes unattended infrastructure for the XRPL Lending Monitor R4C2 remote probe.

## Safety boundary

- Use a Free organization and Free project only.
- Do not add a payment method.
- Do not upgrade the organization or project.
- Do not enable a paid IPv4 add-on, custom domain, branching, larger compute, PITR, or any paid feature.
- Keep Mainnet disabled.
- The first remote deployment is a Devnet ledger-observation probe, not the complete lending collector and not a production recovery.

## 1. Create the project

Create one new Supabase project with:

- organization plan: Free;
- project name: `xrpl-lending-monitor`;
- region: `Northeast Asia (Tokyo)` / `ap-northeast-1`;
- database password: generate a new unique strong password and save it in a password manager;
- no payment method.

Wait until project health is `ACTIVE_HEALTHY`.

Record the project reference shown in the project URL. Do not post the database password, secret key, or personal access token in an issue, pull request, commit, or chat.

## 2. Create the Supabase personal access token

Open Supabase Account > Access Tokens and create one token named:

`xrpl-lending-monitor-github`

The token is long-lived account-level management access. Copy it once and store it only as a GitHub Actions secret.

## 3. Add GitHub Actions secrets

In GitHub repository `badjoke-lab/xrpl-lending-monitor` open:

Settings > Secrets and variables > Actions > New repository secret

Create exactly:

- `SUPABASE_ACCESS_TOKEN` — the personal access token from step 2;
- `SUPABASE_PROJECT_ID` — the Supabase project reference;
- `SUPABASE_DB_PASSWORD` — the unique database password selected at project creation.

Do not add the project secret API key to GitHub. Hosted Edge Functions receive their project URL, database URL, publishable keys, and secret keys as default environment variables.

## 4. Connect Supabase to GitHub

In Supabase Dashboard open the project deployment / GitHub integration settings and connect:

- repository: `badjoke-lab/xrpl-lending-monitor`;
- production branch: `main`;
- Supabase directory: `supabase`;
- deploy to production: enabled;
- preview branches: disabled;
- production data copying: disabled.

This integration must deploy migrations and Edge Functions from `main`. It must not create paid preview branches.

## 5. Store Cron secrets in Vault

Open Project Settings > API and copy:

- Project URL;
- the project secret key named `default` (or the legacy `service_role` key when the new secret key UI is unavailable).

Open SQL Editor and run the following after replacing both placeholders locally:

```sql
create extension if not exists supabase_vault with schema vault;

select vault.create_secret(
  'https://YOUR_PROJECT_REF.supabase.co',
  'xrpl_project_url',
  'XRPL collector Edge Function base URL'
);

select vault.create_secret(
  'YOUR_PROJECT_SECRET_KEY',
  'xrpl_secret_key',
  'XRPL collector Cron authentication key'
);
```

The migration deliberately fails if either named Vault secret is absent. This prevents a deployed function with an unauthenticated or broken Cron path.

Do not paste the real values into the repository or any chat.

## 6. Confirm the setup without exposing secrets

The following non-secret facts are sufficient for handoff:

- project created: yes;
- project region: Tokyo;
- project health: ACTIVE_HEALTHY;
- GitHub integration connected to `badjoke-lab/xrpl-lending-monitor` and `main`;
- deploy to production enabled;
- repository secrets created: all three names present;
- Vault secret names present: `xrpl_project_url`, `xrpl_secret_key`.

A screenshot may show those names and enabled states, but must not show secret values or the database password.

## What happens after setup

After this branch passes CI and merges to `main`, the Supabase GitHub integration should:

1. apply the remote probe migration;
2. deploy `xrpl-collector-tick` with JWT gateway verification disabled and explicit project-secret authentication inside the function;
3. register the `xrpl-lending-monitor-minute` Postgres Cron job;
4. invoke the Edge Function every minute through `pg_net`;
5. claim a 45-second database lease;
6. read the current Devnet validated ledger from the official XRPL JSON-RPC endpoint;
7. atomically complete or fail the tick in Postgres;
8. expose sanitized GET health output from the function URL.

The public GET endpoint reveals only collector status, validated ledger identity, timestamps, counts, and recent run results. POST requires the project secret key and is intended for the Vault-backed Cron job.

## Remote follow-up without Supabase Dashboard

Later work can be driven from GitHub by merging changes under `supabase/`. The stored Actions secrets also permit a later guarded CLI workflow to run `supabase db push`, `supabase functions deploy`, and read-only health checks after the retired workflow surface is removed or replaced.

No Supabase dashboard interaction should be needed after this checklist is complete, except recovering a paused Free project or rotating compromised credentials.
