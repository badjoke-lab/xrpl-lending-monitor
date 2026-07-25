# GitHub Actions workflow policy

The repository intentionally permits only four workflows on the default branch:

1. `ci.yml` — read-only quality gate for pull requests and `main` pushes.
2. `read-only-production-qualification.yml` — one bounded, reusable production-read runner for `probe`, `arm`, and `evaluate`; it has no schedule, no production-write permission, and accepts Issue #995 commands only from the repository owner.
3. `rolling-checkpoint-candidate.yml` — explicitly dispatched checkpoint candidate creation.
4. `rolling-checkpoint-live-cutover.yml` — explicitly dispatched, guarded production cutover.

No scheduled GitHub Actions workflow is permitted. Production monitoring remains in the five-minute Cloudflare Worker path rather than a duplicate five-minute Actions watchdog.

The qualification runner is the only permitted production-read operational workflow. It may read D1, Worker settings/deployments/schedules, public APIs, and Devnet RPC evidence. It must not deploy, mutate D1, send Queue messages, update branches, change cron, arm Mainnet, or write Issue state. Its retained artifacts are used to qualify a fixed 12-slot window before any 24-hour soak.

One-time probes, repairs, deployments, and incident investigations must not be added as new workflow files on `main`. Required production writes must use one of the two guarded checkpoint workflows or a reviewed, bounded repair branch that is removed before merge.

`bash scripts/check-actions-workflow-allowlist.sh` enforces the workflow count, exact names, permitted triggers, absence of schedules, and read-only qualification permissions in CI.
