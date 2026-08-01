# R4B deployment-profile evaluator evidence — 2026-08-01

Status: R4B implementation and validation evidence for PR #1103. R4 remains local and read-only.

## Delivered evaluator

`evaluateDeploymentProfileQualification` accepts one exact versioned input containing:

- a stable profile identity and revision;
- a canonical SHA-256 profile identity digest;
- exactly one evidence record for each of hard gates `G1` through `G10`;
- an optional complete ten-dimension scorecard;
- a canonical evaluation timestamp.

The evaluator produces a deterministic versioned decision with:

- `rejected`, `conditional_candidate`, or `qualified_candidate` classification;
- permanent `selection: not_selected` in R4B;
- hard-gate pass, fail, and unresolved counts;
- ordered failed and unresolved gate IDs;
- ordered retained evidence;
- score summary only when every hard gate passes;
- a canonical SHA-256 decision digest.

## Identity binding

The profile identity contains:

- profile ID;
- revision;
- label;
- storage component;
- scheduler component;
- execution component;
- publication component;
- maintenance component;
- complete-state-transfer component.

Every evidence record is bound to the profile ID, revision, and canonical identity digest. A changed component invalidates the profile digest. Evidence from another revision or profile is rejected.

## Hard-gate behavior

Every hard gate must appear exactly once.

- one or more `fail` records produce `rejected`;
- no failure but one or more `unresolved` records produce `conditional_candidate`;
- all ten `pass` records produce `qualified_candidate`;
- every decision remains `not_selected` because selection belongs to R4E;
- supplying a scorecard while any gate fails or remains unresolved is rejected as `scoring_not_allowed`.

No score or average can override a gate result.

## Scorecard behavior

A supplied scorecard must:

- use schema version 1;
- match the profile identity digest;
- include every one of the ten score dimensions exactly once;
- use integer scores from 0 through 5;
- include a non-empty summary for every dimension.

The evaluator orders dimensions canonically and returns total, maximum `50`, and deterministic two-decimal average.

An all-pass profile may remain unscored and is still only a qualified, unselected candidate.

## Runtime validation

The parser rejects:

- unsupported schema versions;
- extra or missing fields;
- malformed profile IDs and digests;
- non-canonical timestamps;
- duplicate or missing hard gates;
- duplicate artifacts;
- changed profile identity;
- foreign evidence;
- incomplete or foreign scorecards;
- out-of-range scores.

The implementation imports only provider-neutral local modules and performs no provider call.

## Conformance evidence

The R4B suite proves:

1. deterministic identical decisions from identical inputs;
2. stable canonical decision bytes and digest;
3. all-pass scored and unscored decisions remain unselected;
4. unresolved gates remain conditional and unscored;
5. failed gates are rejected and unscored;
6. changed profile components fail identity verification;
7. evidence from another revision fails identity verification;
8. every hard gate is required exactly once;
9. every score dimension is required exactly once when a scorecard exists;
10. unsupported versions, extra fields, non-canonical timestamps, and invalid scores fail closed.

## Retained validation

Implementation head `e17020bb001d8e848a32e4fc8ac76bbdcdf6db40` passed CI run `30703462350`:

- Actions workflow-surface guard;
- lint;
- D1 headroom and live-cutover shell syntax validation;
- canonical production base identity validation;
- TypeScript type-check;
- production runner bundle and configuration validation;
- complete unit-test suite;
- complete clean local migration sequence through migration `10007`;
- application build;
- browser smoke.

## Boundary

R4B selects no profile and creates no hosted resource, credential, payment method, billing state, remote deployment, production mutation, public-reader switch, Queue, Cron, Mainnet state, recovery, qualification window, or soak.

R4C is next: local profile harnesses for service-managed SQLite, Postgres transaction/scheduler semantics, libSQL/Turso-compatible storage semantics, and Cloudflare resource modeling without remote deployment.
