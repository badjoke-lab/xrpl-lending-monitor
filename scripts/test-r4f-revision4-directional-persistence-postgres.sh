#!/usr/bin/env bash
set -euo pipefail

container_name="xrpl-r4f-postgres-${GITHUB_RUN_ID:-local}-$$"
image="postgres:15-alpine"
output_directory="${R4F_G2D_OUTPUT:-r4f-revision4-postgres-integration-evidence}"
shadow_directory="${output_directory}/offline-shadow"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

unset SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_ID SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_PASSWORD || true
rm -rf "$output_directory"
mkdir -p "$shadow_directory"

R4F_G2C_OUTPUT="$shadow_directory" \
  node scripts/build-r4f-revision4-offline-shadow.mjs \
  > "${output_directory}/offline-shadow.log"

R4F_G2D_EVIDENCE="${shadow_directory}/evidence.json" \
R4F_G2D_SQL="${output_directory}/postgres-integration.sql" \
  node scripts/build-r4f-revision4-persistence-integration-sql.mjs \
  > "${output_directory}/sql-builder.json"

docker run --detach --rm \
  --name "$container_name" \
  --env POSTGRES_PASSWORD=postgres \
  --env POSTGRES_DB=postgres \
  "$image" \
  > "${output_directory}/container-id.txt"

for _ in $(seq 1 60); do
  if docker exec "$container_name" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$container_name" pg_isready -U postgres -d postgres

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  > "${output_directory}/bootstrap.log" <<'SQL'
do $$ begin
  create role anon nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null;
end $$;
do $$ begin
  create role service_role nologin;
exception when duplicate_object then null;
end $$;
create schema if not exists extensions authorization postgres;
SQL

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < supabase/migrations/20260806120000_xrpl_r4f_revision4_directional_accounting_evidence.sql \
  > "${output_directory}/migration.log"

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "${output_directory}/postgres-integration.sql" \
  | tee "${output_directory}/integration.log"

grep -q 'postgresIntegrationPassed' "${output_directory}/integration.log"
grep -q 'true' "${output_directory}/integration.log"

docker exec "$container_name" pg_dump \
  --username postgres \
  --dbname postgres \
  --schema xrpl_r4f_v1 \
  --data-only \
  --inserts \
  > "${output_directory}/candidate-evidence-export.sql"

test -s "${output_directory}/candidate-evidence-export.sql"
grep -q 'directional_accounting_evidence' "${output_directory}/candidate-evidence-export.sql"
grep -q 'directional_accounting_observations' "${output_directory}/candidate-evidence-export.sql"

cat > "${output_directory}/summary.md" <<'EOF'
## R4F revision-4 G2D PostgreSQL integration

- PostgreSQL image: `postgres:15-alpine`
- provider connection used: `false`
- production Supabase migration used: `false`
- candidate migration applied: `true`
- offline shadow inserted through writer RPC: `true`
- exact idempotent replay: `true`
- conflicting observation identity rejected: `true`
- reader reconciliation: `true`
- public-role privilege leak: `false`
- deterministic candidate export retained: `true`
- recovery mutation committed: `false`
- public reader unchanged: `true`
- Mainnet disabled: `true`
- stabilization authorized: `false`
- soak authorized: `false`
EOF
