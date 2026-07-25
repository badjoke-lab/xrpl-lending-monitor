# GitHub Actions workflow policy

The repository intentionally permits only four workflows on the default branch:

1. `ci.yml` — read-only quality gate for pull requests and `main` pushes.
2. `read-only-production-qualification.yml` — one bounded, reusable production-read runner for `probe`, `arm`, and `evaluate`; it has no schedule, no production-write permission, and accepts Issue #995 commands only from the repository owner.
3. `rolling-checkpoint-candidate.yml` — explicitly dispatched checkpoint candidate creation.
4. `rolling-checkpoint-live-cutover.yml` — explicitly dispatched, guarded production cutover.

No scheduled GitHub Actions workflow is permitted. Production monitoring remains in the five-minute Cloudflare Worker path rather than a duplicate five-minute Actions watchdog.

The qualification runner is the only permitted production-read operational workflow. It may read D1, Worker settings/deployments/schedules, public APIs, and Devnet RPC evidence. It must not deploy, mutate D1, send Queue messages, update branches, change cron, arm Mainnet, or change Issue state. Its only GitHub write capability is posting a bounded probe/arm/evaluate result comment to Issue #995 so the run remains externally auditable without creating temporary workflows.

One-time probes, repairs, deployments, and incident investigations must not be added as new workflow files on `main`. Required production writes must use one of the two guarded checkpoint workflows or a reviewed, bounded repair branch that is removed before merge.

`bash scripts/check-actions-workflow-allowlist.sh` enforces the workflow count, exact names, permitted triggers, absence of schedules, production-read boundary, and Issue-only qualification reporting in CI.
