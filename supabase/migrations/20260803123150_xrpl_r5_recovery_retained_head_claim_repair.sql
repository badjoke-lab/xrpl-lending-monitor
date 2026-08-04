-- Migration-history tombstone.
-- Version 20260803123150 was recorded by the remote migration history during
-- a failed repair attempt. It intentionally performs no schema or data
-- mutation. The forward-only functional repair is migration 20260803123300.
do $$
begin
  null;
end;
$$;
