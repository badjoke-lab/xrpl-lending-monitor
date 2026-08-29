# P0 Current repair Queue pause API fix — 2026-08-29

## Incident

Production Queue delivery pause-only run `33264682335` reached the mutation step only after all exact authorization and live safety guards passed.

The retained pre-state proved:

- Queue delivery active;
- backlog count and bytes both zero;
- Worker Cron empty;
- Devnet only and Mainnet disabled;
- `FAST_LANE_MAX_LEDGERS_PER_RUN=32`;
- pending Queue slots `0`;
- live unstaged processing slots `0`;
- staged successor slots `0`;
- active Worker deployment version `fb27bd55-e624-439d-add2-2ed41e903c34`.

The pause step failed because the manager used the wrong Cloudflare Queue update request shape. It called the `/settings` subpath with an unnested `delivery_paused` body. The API request returned without producing the intended paused state. The final read proved `settings.delivery_paused=false`.

The failed operation did not resume the Queue and did not deploy a Worker, mutate D1 or Supabase, create a Cron, enable Mainnet, send/reseed/purge Queue messages, or restart Current catch-up. Production Queue delivery therefore remained active after the failed run.

## Correction

The Queue pause manager now uses the provider's Queue update contract:

- `PATCH /accounts/{account_id}/queues/{queue_id}`;
- body `{"settings":{"delivery_paused":true}}`.

The manager now distinguishes three states:

1. a production mutation request was sent;
2. the mutation response explicitly reported `settings.delivery_paused=true`;
3. a subsequent independent Queue read observed delivery paused.

`queuePausePerformed=true` is recorded only after the independent read observes the paused state. An accepted HTTP/API response that does not report the requested Queue setting now fails closed before the operation can be called performed.

The Actions policy check is updated to require the corrected endpoint and nested body and to reject the obsolete `/settings` subpath.

## Retry boundary

A retry remains Queue delivery pause-only. Immediately before mutation it must re-prove the same live guards. It still does not authorize Worker deployment, Queue resume/send/reseed/purge, D1/Supabase mutation, Cron creation, Mainnet enablement, or Current restart.
