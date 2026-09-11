# XRPL Lending Monitor

Devnet lending monitor with one runtime path:

`XRPL -> scheduled collector -> D1 -> API -> UI`

The Worker refreshes the validated XRPL head, processes ledgers forward from the persisted D1 cursor, stores lending events/current-state changes, and serves the monitoring UI/API.

There is no Queue recovery control plane, replay/cutover workflow, shadow promotion pipeline, replacement-base operator, or GitHub Actions command interface in this branch.

## Commands

- `pnpm dev` — UI development server
- `pnpm dev:worker` — Worker development server
- `pnpm typecheck` — UI and Worker type checking
- `pnpm build` — production UI build
- `pnpm deploy` — build and deploy the Worker/assets
- `pnpm db:migrate:local` — apply D1 migrations locally
