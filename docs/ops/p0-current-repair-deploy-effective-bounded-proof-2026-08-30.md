# P0 Current repair deploy effective state and bounded proof — 2026-08-30

## Effective production deployment

The Current repair runtime is now the effective production Worker version while Queue delivery remains paused.

Retained sequence:

- repaired runtime source commit: `4f3f185da6e5093d0a5ce13b43b22f3070e630b3`;
- main control commit at deployment: `a4a8fa0be42957643a8551517099c0fac937d8d3`;
- prior Worker version: `fb27bd55-e624-439d-add2-2ed41e903c34`;
- new Worker version: `c858ab5d-846e-4bd4-b26b-8f71c9382f8f`;
- deploy execution run: `33287377843`;
- fresh independent read-only post-deploy preflight: `33287456830`.

The deploy command itself reported the new version deployed at 100%. The deploy workflow nevertheless ended red because its final public smoke used Python urllib's default request identity and received HTTP 403. That failure happened after the Cloudflare deployment, Queue/D1/scheduler invariants, and source checks had passed.

A fresh independent read-only preflight then observed `c858ab5d-846e-4bd4-b26b-8f71c9382f8f` as the single 100% production Worker version and passed its public API checks using the same explicit public request headers already used by the established restart preflight. Therefore the production repair deployment is effective; it must not be repeated merely to turn the earlier workflow green.

The attempted rollback after the false smoke failure did not succeed. The subsequent independent preflight is authoritative for current production identity and proves that the repaired version remains active.

## Current stopped boundary

After deployment and independent verification:

- Queue delivery remains paused;
- Queue backlog was empty before the next proof preparation;
- Worker Cron remains empty;
- `APP_NETWORK=devnet`;
- `MAINNET_ENABLED=false`;
- `FAST_LANE_MAX_LEDGERS_PER_RUN=32`;
- no continuous Current catch-up is authorized;
- Supabase History/R5 remains a separate halted path and is unchanged.

The retained D1 Current cursor before bounded execution remains `4,051,454`. Existing stale reclaimable Queue-slot rows are historical residue; there is no live unstaged processing slot, staged successor slot, or pending slot at the bounded-proof entry gate.

## Next gate: one-invocation bounded Current proof

The next production unit is deliberately smaller than continuous restart.

The bounded proof must:

1. re-prove the exact paused state, repaired Worker version, Devnet/Mainnet boundary, empty Cron, empty Queue backlog, and no live/pending/staged Queue slot;
2. enqueue exactly one delayed proof message while Queue delivery is still paused;
3. resume Queue delivery only for that exact message;
4. as soon as the exact D1 Queue slot is observed processing, completed, or errored, immediately pause Queue delivery again;
5. allow only the already in-flight Worker invocation to finish;
6. require the exact slot to complete without error;
7. require the fast-lane cursor to advance by at least one and no more than the fixed 32-ledger application cap;
8. require the repaired Worker version, empty Cron, and paused Queue state to remain unchanged;
9. require the successor to be staged by the completed slot but not delivered while Queue delivery is paused.

A successful bounded proof leaves Queue delivery paused with continuous catch-up still stopped. Resuming delivery after that proof is a separate production decision and authorization.

No Queue purge, Cron creation, Mainnet enablement, Supabase mutation, or History/R5 rearm belongs to this unit.
