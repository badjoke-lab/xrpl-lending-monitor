# Repository operating instructions

These instructions apply to every contributor and coding agent working in this repository, including long-running Codex goal sessions.

## Scope

This root `AGENTS.md` applies to the entire repository. A nested `AGENTS.md` may add directory-specific rules but must not weaken the product, data-integrity, testing, security, UI, accessibility, or release rules defined here.

## Source of truth

Before planning, editing, testing, reviewing, or resuming work, read:

1. `AGENTS.md`
2. `docs/README.md`
3. `docs/product-spec.md`
4. `docs/development-roadmap.md`
5. `docs/implementation-status.md`
6. every domain document linked from the active roadmap item
7. every UI source-of-truth document linked from the active M4 or M5 roadmap item
8. `docs/codex-goal.md` and `docs/codex-master-task.md` for the long-running Codex objective
9. `docs/codex-ui-task.md` before M4 or M5 UI work

Repository documents are authoritative. Conversation history, generated mockup values, temporary audit code, previous agent summaries, and assumptions are not authoritative when they conflict with the repository.

`docs/development-roadmap.md` controls order and dependencies. `docs/implementation-status.md` controls the resume point. Inspect Git history, open pull requests, branches, and CI before trusting stale text; correct stale documentation in the same pull request.

For UI work, `docs/ui-information-architecture.md`, `docs/ui-page-map.md`, `docs/ui-page-specifications.md`, `docs/ui-design-spec.md`, `docs/ui-component-inventory.md`, `docs/ui-responsive-rules.md`, and `docs/ui-reference/README.md` are mandatory source-of-truth documents.

## Session startup and resume

At the start of every session:

1. inspect `main`, open pull requests, active branches, recent commits, and required checks;
2. read the source-of-truth documents;
3. identify the first incomplete dependency or release gate;
4. verify whether work already exists before creating a branch or reimplementing it;
5. resume the canonical branch or pull request when one exists;
6. update `docs/implementation-status.md` before the session ends when repository state changed.

Do not redo merged or otherwise verified work. A later agent must be able to resume from repository and GitHub state without relying on chat history.

## Autonomous execution

The accepted long-running objective is to complete the read-only public Devnet release defined by `docs/product-spec.md` and `docs/development-roadmap.md`.

Continue through the roadmap in dependency order without asking for confirmation between ordinary implementation steps. A milestone boundary, target date, pull-request boundary, CI run, context-window boundary, or usage-limit interruption is not itself a reason to abandon the objective.

Stop only when:

- a human approval gate listed below is reached;
- external account access or resource provisioning is required and unavailable;
- authoritative specifications conflict and no safe interpretation exists;
- live protocol evidence contradicts the accepted model;
- required checks cannot pass without changing approved scope or weakening an invariant;
- repository permissions prevent the required action.

When blocked, record the exact blocker, completed evidence, current branch or pull request, first incomplete action, and required decision in `docs/implementation-status.md`. Continue independent work that does not cross the blocked dependency.

## Mandatory work sequence

For every roadmap unit:

1. identify the milestone and roadmap unit;
2. confirm current repository and pull-request state;
3. read the relevant specifications and operational documents;
4. define acceptance criteria and invariants;
5. implement the agreed scope and necessary supporting changes;
6. add or update all applicable tests;
7. run required local and CI validation;
8. update `docs/implementation-status.md` in the same pull request;
9. update roadmap, specifications, resource envelope, UI documents, or decision log when behavior or accepted decisions change;
10. open or update a focused pull request with evidence and rollback considerations;
11. resolve failures and review findings without weakening checks;
12. merge only after required checks pass and the branch has the intended predecessor;
13. proceed to the next incomplete dependency when no human gate remains.

Do not silently diverge from specifications. Change the specification first or in the same pull request.

## Branch and pull-request discipline

- Work from the current canonical predecessor, normally `main` or the explicitly active pull-request branch.
- Prefer one coherent roadmap unit per pull request.
- Do not create parallel implementations of the same feature.
- Avoid stacking dependent pull requests on unverified work; document unavoidable dependencies.
- Update from the current predecessor before final validation when the base changed materially.
- Do not rewrite shared history unless explicitly approved.
- Do not merge with failing required checks, unresolved material findings, stale migrations, or inconsistent documentation.
- When merge permission is unavailable, leave a reviewable pull request with passing checks and record the blocker.

Roadmap unit labels are planning identifiers and may not match GitHub pull-request numbers. Identify work by milestone and scope, not number alone.

The historical UI WIP checkpoint on `ui/overview-status-shell` at `aa623b9` is not a competing implementation and must not be merged as-is.

## Required validation

The baseline full check is:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm test:e2e
```

Use narrower checks while iterating, but run all checks relevant to the changed surface before merge. Every implementation pull request must satisfy `docs/testing-strategy.md`.

Additional evidence is required when applicable:

- local D1 migration application for schema changes;
- fixture-ledger replay for parser, history, lifecycle, archive, and reconciliation work;
- non-destructive live Devnet reads for network-dependent collectors;
- browser evidence for user-visible flows, responsive states, and accessibility;
- route, link, heading, and schedule consistency for documentation-only UI planning changes;
- runtime, request, storage, and catch-up measurements for collector changes;
- rollback and interruption evidence for bootstrap, persistence, deployment, and recovery changes.

Do not delete, skip, weaken, or broadly mock a failing test merely to obtain a green check.

## State persistence

Before a session ends or an execution limit interrupts work:

- commit and push coherent completed changes;
- avoid leaving the only copy of important work in an uncommitted workspace;
- update the pull-request description when scope or evidence changes;
- update `docs/implementation-status.md` with the exact current state;
- record reproducible test and live-read evidence where safe;
- identify the first incomplete action rather than a vague future milestone;
- record blockers without protected information.

## Human approval gates

Do not perform these actions without explicit human approval:

- create or modify paid or production infrastructure;
- create or change protected production configuration;
- provision or connect production D1, R2, Workers, or domains;
- deploy publicly to the production domain;
- approve final legal, disclaimer, privacy, terms, commercial, or Contact text;
- enable transaction submission, signing, wallet integration, or write operations;
- enable Mainnet collection or change the approved Mainnet start strategy;
- weaken a release gate, integrity invariant, retention safeguard, or fail-closed behavior.

When approval is absent, implement and test adapters, migrations, local flows, unavailable states, and documented provisioning steps without claiming production evidence.

## Non-negotiable product rules

- The initial product is read-only.
- No wallet connection, signing, transaction submission, lending, repayment, or deposit UI is allowed in the initial release.
- Funding, donation, payment, and promotional surfaces are outside the current release scope.
- Devnet and Mainnet data must never be mixed.
- Every stored record must include network and epoch identity.
- Current state, indexed history, derived values, and unavailable data must remain distinguishable.
- XRP, IOU, and MPT assets must remain distinct.
- Unlike assets must not be combined into synthetic TVL without an explicit documented pricing layer.
- USD or fiat conversion and oracle or DEX pricing are prohibited until a separate pricing subsystem is approved.
- On-ledger state and schedule-derived state must be stored and displayed separately.
- A late loan must not be labelled defaulted unless the ledger state says it is defaulted.
- Deleted Vault, LoanBroker, and Loan objects must leave current projections but remain searchable through indexed history.
- Derived values must expose formula and provenance.
- Do not invent unavailable protocol facts, identity claims, collateral values, scoring, operational metrics, or investment recommendations.
- Unknown fields and unsupported transaction shapes must be preserved or reported safely.
- Collection must be restartable, idempotent, marker-aware or cursor-aware, gap-rejecting, and bounded by the documented resource envelope.
- A partial bootstrap must never activate or be reported as complete.
- Cursor advancement, processed-ledger persistence, and canonical event persistence must be atomic.
- Reprocessing must not create duplicate canonical events.
- Mainnet remains disabled until its prerequisites and release approval are explicitly accepted.
- Generated UI mockups define layout direction only and never define data.
- Missing data is not zero.
- About, Methodology, Contact, and API documentation are required baseline pages.

## UI implementation rules

- Use the approved dark ledger-observatory direction.
- Provide desktop sidebar, mobile navigation, and persistent network context as specified.
- Keep human-readable summaries before technical and raw data.
- Implement loading, empty, unavailable, stale, partial, error, archived, not-found, and invalid-identifier states.
- Preserve keyboard access, visible focus, semantic landmarks, contrast, zoom, reduced motion, long identifiers, and responsive behavior.
- Do not publish placeholder external links.
- Contact uses configured Google Form and GitHub Issues destinations only.

## Documentation gates

A pull request is incomplete when:

- implementation and documentation disagree;
- `docs/implementation-status.md` is stale;
- roadmap dependencies or completion state are stale;
- a new table, field, state, API, page, route, event, formula, retention rule, responsive behavior, external dependency, or operational dependency is undocumented;
- a calculation lacks formula and provenance;
- a material resource implication is not recorded;
- a new unresolved assumption is not listed;
- required evidence is missing;
- generated mockup data has been copied without API support;
- Contact uses an unapproved or placeholder configuration.

## Public-information boundary

Repository content and generated artifacts must not contain protected configuration, private endpoints, unredacted personal data, unpublished operational strategy, seeds or private keys, or unnecessary cross-project context. Use redacted fixtures and bounded evidence. Explain decisions through product integrity, security, maintainability, measurable resource limits, accessibility, and operational reliability.

## Current execution phase

M0, M2, M3, and M4-0 through M4-3 are complete. M1 code foundations are complete but isolated full bootstrap verification and activation remain. The immediate independent continuation point is M4-4: verified current-state Loan reads followed by the Loan list and detail UI. Production deployment and Mainnet remain disabled.