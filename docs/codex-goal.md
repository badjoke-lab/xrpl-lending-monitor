# Codex durable goal

## Goal text

Complete XRPL Lending Monitor as the read-only public Devnet monitor and historical audit layer defined by this repository.

Begin from the actual state of `main`, open pull requests, CI, `AGENTS.md`, `docs/development-roadmap.md`, and `docs/implementation-status.md`. Do not repeat verified work. Resume the first incomplete dependency and continue through M1, M2, M3, M4, M5, and M6 in roadmap order.

For every roadmap unit, implement the agreed scope, add the required tests, update documentation, create or update a focused pull request, resolve failures, merge only when authorized and all checks pass, record the exact new state in `docs/implementation-status.md`, and continue to the next dependency.

Preserve the read-only boundary, network and epoch isolation, asset separation, provenance, deterministic history, deleted-object archives, restartability, idempotency, atomic persistence, bounded resource use, fail-closed release gates, and the approved UI information architecture.

Before M4 or M5 UI work, read and follow the UI source-of-truth documents indexed in `docs/README.md`, including `docs/codex-ui-task.md`. Do not treat generated mockup values as data. Do not merge the light-theme WIP checkpoint on `ui/overview-status-shell` as the approved interface.

Persist progress in GitHub before any session ends so later work can resume without chat history. Stop only for a human approval gate, unavailable external access, contradictory authoritative evidence, an unresolved specification conflict, a required check that cannot safely pass, or insufficient repository permission. Record the exact blocker and continue independent safe work.

## Initial task

Use `docs/codex-master-task.md` as the initial task after setting this goal. For M4 and M5 UI work, also use `docs/codex-ui-task.md`.

## Resume task

Read `AGENTS.md`, `docs/codex-goal.md`, `docs/codex-master-task.md`, `docs/codex-ui-task.md`, `docs/development-roadmap.md`, and `docs/implementation-status.md`. Inspect `main`, open pull requests, branches, recent commits, and CI. Resume from the first incomplete dependency or release gate. Do not redo completed work. Persist the exact state before the session ends.
