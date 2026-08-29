# P0 Current repair deploy-only boundary — 2026-08-29

## Purpose

Install the already-qualified Current fast-lane subrequest repair Worker runtime without restarting Current collection.

The exact runtime identity is:

- runtime commit: `4f3f185da6e5093d0a5ce13b43b22f3070e630b3`;
- repair PR: `#1490`;
- production Current restart preflight: `safeToDeployRepair=true`, `safeToRestart=false` from PR `#1491` read-only evidence.

## Deploy-only invariants

The deploy-only operation must fail closed unless all of the following remain true before deployment:

- the Queue is already paused;
- Worker schedules are empty;
- D1 physical size remains below the existing 350,000,000-byte guard;
- runtime source/config exactly matches the pinned repair commit for `src`, `wrangler.jsonc`, `package.json`, and `pnpm-lock.yaml`;
- `APP_NETWORK=devnet`;
- `MAINNET_ENABLED=false`;
- `FAST_LANE_MAX_LEDGERS_PER_RUN=32`;
- Queue batch size and concurrency remain `1 / 1`;
- repair constants remain fallback `4`, persistence D1 queries `24`, mutation group `256`, history group `8`, and same-invocation transient attempts `1`.

After deployment it must re-prove:

- Queue still paused;
- Queue backlog metrics unchanged;
- schedules still empty;
- D1 physical size unchanged;
- Devnet/Mainnet and Queue bindings unchanged;
- public read-only API smoke remains HTTP 200.

## Explicit non-actions

The deploy-only operation does not:

- send or seed a Queue message;
- resume Queue delivery;
- purge Queue contents;
- create a Cron trigger;
- mutate D1 rows or schema;
- change public-reader semantics;
- touch Supabase History recovery;
- enable Mainnet;
- authorize stabilization or soak.

A failed post-deploy invariant may roll the Worker version back to the previously active version while keeping the Queue stopped.

## Authorization boundary

Merging the deploy-only implementation does not authorize production execution. Production deployment requires a separate exact deploy authorization bound to the pinned runtime SHA. Queue reseed/restart requires a later, separate authorization and evidence gate.
