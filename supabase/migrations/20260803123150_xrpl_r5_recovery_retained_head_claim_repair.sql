-- A failed remote migration attempt can leave the function catalog entry present
-- without recording migration 20260803123200. Remove only that exact signature
-- before the canonical migration recreates it and restores the intended grants.
drop function if exists public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(
  text,
  text,
  timestamptz,
  integer
);
