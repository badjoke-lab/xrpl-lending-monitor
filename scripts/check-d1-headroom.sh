#!/usr/bin/env bash
set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${D1_HEADROOM_OUTPUT_DIR:-d1-headroom}"
READ_ALLOWANCE="${D1_ROWS_READ_DAILY_ALLOWANCE:-5000000}"
WRITE_ALLOWANCE="${D1_ROWS_WRITTEN_DAILY_ALLOWANCE:-100000}"
HEADROOM_FRACTION="${D1_HEADROOM_FRACTION:-0.8}"
DATABASE_ID="${D1_DATABASE_ID:-}"

if [[ -z "${DATABASE_ID}" ]]; then
  DATABASE_ID="$(jq -r '.d1_databases[] | select(.binding == "DB") | .database_id' "${ROOT_DIR}/wrangler.jsonc")"
fi

if [[ -z "${DATABASE_ID}" || "${DATABASE_ID}" == "null" ]]; then
  echo 'Unable to resolve the DB D1 database ID from D1_DATABASE_ID or wrangler.jsonc' >&2
  exit 1
fi

mkdir -p "${OUTPUT_DIR}"
TODAY="$(date -u +%F)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

read -r -d '' QUERY <<'GRAPHQL' || true
query D1Usage(
  $accountTag: string!
  $start: Date
  $end: Date
  $databaseId: string
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      d1AnalyticsAdaptiveGroups(
        limit: 10000
        filter: {
          date_geq: $start
          date_leq: $end
          databaseId: $databaseId
        }
      ) {
        sum {
          readQueries
          writeQueries
          rowsRead
          rowsWritten
        }
      }
    }
  }
}
GRAPHQL

jq -n \
  --arg query "${QUERY}" \
  --arg accountTag "${CLOUDFLARE_ACCOUNT_ID}" \
  --arg start "${TODAY}" \
  --arg end "${TODAY}" \
  --arg databaseId "${DATABASE_ID}" \
  '{query: $query, variables: {accountTag: $accountTag, start: $start, end: $end, databaseId: $databaseId}}' \
  > "${TMP_DIR}/request.json"

curl --fail-with-body --silent --show-error --retry 3 \
  -X POST \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H 'Content-Type: application/json' \
  --data @"${TMP_DIR}/request.json" \
  https://api.cloudflare.com/client/v4/graphql \
  > "${TMP_DIR}/response.json"

jq -e '((.errors // []) | length) == 0 and (.data.viewer.accounts | length) > 0' \
  "${TMP_DIR}/response.json" > /dev/null

jq \
  --arg date "${TODAY}" \
  --argjson readAllowance "${READ_ALLOWANCE}" \
  --argjson writeAllowance "${WRITE_ALLOWANCE}" \
  --argjson headroomFraction "${HEADROOM_FRACTION}" '
    [.data.viewer.accounts[0].d1AnalyticsAdaptiveGroups[]] as $groups
    | {
        date_utc: $date,
        read_queries: ([$groups[].sum.readQueries // 0] | add // 0),
        write_queries: ([$groups[].sum.writeQueries // 0] | add // 0),
        rows_read: ([$groups[].sum.rowsRead // 0] | add // 0),
        rows_written: ([$groups[].sum.rowsWritten // 0] | add // 0),
        rows_read_daily_allowance: $readAllowance,
        rows_written_daily_allowance: $writeAllowance,
        required_headroom_fraction: $headroomFraction
      }
    | .rows_read_fraction = (.rows_read / .rows_read_daily_allowance)
    | .rows_written_fraction = (.rows_written / .rows_written_daily_allowance)
    | .passed = (
        .rows_read_fraction < .required_headroom_fraction
        and .rows_written_fraction < .required_headroom_fraction
      )
  ' "${TMP_DIR}/response.json" > "${OUTPUT_DIR}/d1-headroom-summary.json"

jq . "${OUTPUT_DIR}/d1-headroom-summary.json"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  jq -r '
    "date_utc=\(.date_utc)",
    "rows_read=\(.rows_read)",
    "rows_written=\(.rows_written)",
    "rows_read_fraction=\(.rows_read_fraction)",
    "rows_written_fraction=\(.rows_written_fraction)",
    "passed=\(.passed)"
  ' "${OUTPUT_DIR}/d1-headroom-summary.json" >> "${GITHUB_OUTPUT}"
fi

jq -e '.passed == true' "${OUTPUT_DIR}/d1-headroom-summary.json" > /dev/null
