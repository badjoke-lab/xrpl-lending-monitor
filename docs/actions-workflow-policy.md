# GitHub Actions workflow policy

The repository intentionally permits only three workflows on the default branch:

1. `ci.yml` — read-only quality gate for pull requests and `main` pushes.
2. `rolling-checkpoint-candidate.yml` — explicitly dispatched checkpoint candidate creation.
3. `rolling-checkpoint-live-cutover.yml` — explicitly dispatched, guarded production cutover.

No scheduled GitHub Actions workflow is permitted. Production monitoring remains in the five-minute Cloudflare Worker path rather than a duplicate five-minute Actions watchdog.

One-time probes, repairs, deployments, qualifications, and incident investigations must be created on a bounded branch, reviewed, run only when required, and deleted before merge or immediately after their evidence is retained. They must not remain on `main` as dormant operational controls.

`bash scripts/check-actions-workflow-allowlist.sh` enforces this policy in CI.
