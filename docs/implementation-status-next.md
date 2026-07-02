# Implementation status update

Last updated: 2026-07-02.

PR #28, `Add verified current Loan API reads`, is merged at `3b9bc33b69f4e0648176353139a4d38100bcf69b`.

PR #29, `Add current Loan monitor UI`, is active on `ui/current-loan-monitor`. Validation run `28575265730` passed lint, type-check, unit tests, local D1 migrations, production build, and all browser tests.

The Loan list and detail routes now provide exact current balances, separate direct and schedule-derived states, verified Broker and Vault links, responsive layouts, explicit unavailable states, and no inferred indexed history.

The first incomplete action is the final required CI rerun after documentation alignment, followed by merge of PR #29 if all checks remain green. The next roadmap unit is M4-5 Activity and Transaction UI.

The preview bootstrap and active current-state binding remain a separate approval-gated M1 closeout track.