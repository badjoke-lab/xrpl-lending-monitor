#!/usr/bin/env bash
set -euo pipefail

# Supabase GitHub Integration can apply newly-added files under
# supabase/migrations automatically when a PR is merged to the production
# branch.  Until that dashboard-level auto-deploy path is disabled, production-
# bound SQL must be staged outside this directory and applied only through the
# explicit owner authorization path.

if [[ "${GITHUB_EVENT_NAME:-}" != 'pull_request' ]]; then
  echo 'Supabase production auto-deploy boundary: non-PR event, no diff gate required.'
  exit 0
fi

if [[ -z "${GITHUB_EVENT_PATH:-}" || ! -f "${GITHUB_EVENT_PATH}" ]]; then
  echo 'GITHUB_EVENT_PATH is required for pull_request auto-deploy boundary checks.' >&2
  exit 1
fi

base_ref="$(jq -r '.pull_request.base.ref // empty' "$GITHUB_EVENT_PATH")"
if [[ -z "$base_ref" || "$base_ref" == 'null' ]]; then
  echo 'Could not resolve pull request base ref.' >&2
  exit 1
fi

remote_base="refs/remotes/origin/${base_ref}"
git fetch --no-tags --depth=1 origin "+refs/heads/${base_ref}:${remote_base}"

mapfile -t added_migrations < <(
  git diff --diff-filter=A --name-only "$remote_base" HEAD -- 'supabase/migrations/*.sql'
)

if (( ${#added_migrations[@]} == 0 )); then
  echo 'Supabase production auto-deploy boundary: no newly-added Supabase migrations.'
  exit 0
fi

{
  echo 'Refusing PR because it adds Supabase migration files while GitHub Integration production auto-deploy is active.'
  echo 'New migration files would be eligible for automatic production application on merge, bypassing Issue #1261 owner prepare/authorize/execute.'
  echo 'Stage production-bound SQL outside supabase/migrations until the automatic production deployment path is disabled or a separately audited post-apply repository-sync exception is implemented.'
  echo 'Blocked files:'
  printf '  - %s\n' "${added_migrations[@]}"
} >&2
exit 1
