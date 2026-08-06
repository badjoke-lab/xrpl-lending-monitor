# R4F G3B bounded provider capture contract

Date: `2026-08-06`.
Controlling issue: `#1261`.
Candidate identity: `supabase_free_postgres_pgcron_edge` revision `4`, digest `39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5`.

## Purpose

G3B defines the evidence package required for one future bounded Dashboard capture. It does not authorize or execute that capture.

No provider request, provider mutation, Supabase migration, Edge deployment, R5 restart, public-reader change, Mainnet operation, stabilization, or soak is included.

## Authorization boundary

An executed capture is valid only when a separate Issue `#1261` owner comment authorizes the exact scope `r4f_g3_dashboard_capture` and supplies a positive comment ID retained in the evidence input.

The current committed template is explicitly unexecuted:

- `executionAuthorized: false`;
- `providerRequestAuthorized: false`;
- `providerMutationAuthorized: false`;
- `r5Authorized: false`;
- `profileSelected: false`.

The synthetic fixture is arithmetic-only and can never satisfy G3.

## Display-to-byte interval conversion

The contract supports:

- units: `bytes`, `kB`, `MB`, `GB`, `KiB`, `MiB`, `GiB`;
- rounding: `exact`, `nearest_half_up`, `truncate_down`;
- zero through nine explicit decimal places.

The displayed string must preserve the exact number of shown decimal places. It is parsed with integer arithmetic; floating-point conversion is not used.

For a display value represented as integer `n` at scale `s`, with unit size `u` bytes:

### Exact

```text
lower = upper = n × u / s
```

The value is rejected when this is not a whole number of bytes.

### Nearest, half up

```text
lower = ceil((2n - 1) × u / (2s))
upper = ceil((2n + 1) × u / (2s)) - 1
```

### Truncate down

```text
lower = ceil(n × u / s)
upper = ceil((n + 1) × u / s) - 1
```

The derived before and after intervals are passed to the G3A reconciliation planner. No rounded Dashboard value is treated as an exact byte counter unless the source explicitly presents whole exact bytes.

## Required evidence

One executed input must retain:

- exact revision-4 profile identity;
- unique capture ID;
- authorization issue, owner, scope, and comment ID;
- SHA-256 digest of the project identity, never the project reference in clear text;
- one billing period containing both observations;
- before and after display strings, units, decimal places, rounding rules, UTC timestamps, and source artifacts;
- application directional-accounting upper bound, retained reserve, accounting digest, source commit, and source run;
- proof that concurrent project traffic was excluded;
- provider capability observations;
- unchanged safety flags.

The evidence package rejects placeholder project digests, malformed commits and digests, cross-period timestamps, empty artifacts, counter resets, absent authorization, and concurrent traffic.

## Offline verifier

Build:

```bash
pnpm exec vite build --config vite.r4f-revision4-provider-capture-verifier.config.ts
```

Verify without requiring qualification:

```bash
node .r4f-revision4-provider-capture-verifier-build/verify-r4f-revision4-provider-capture.mjs \
  --input <capture-input.json> \
  --output <capture-evidence.json>
```

Require a qualifying result:

```bash
node .r4f-revision4-provider-capture-verifier-build/verify-r4f-revision4-provider-capture.mjs \
  --input <capture-input.json> \
  --output <capture-evidence.json> \
  --require-qualified
```

The verifier performs only local file reads, computation, and one local file write. It contains no network, provider credential, database, deployment, issue-write, or active R5 capability. With `--require-qualified`, an unqualified capture retains its evidence output and exits with code `2`.

## Required operator sequence after separate authorization

1. Freeze the exact revision-4 source commit and application accounting digest.
2. Confirm the Dashboard project filter and billing period.
3. Record the displayed unit, decimal places, and actual rounding behavior supported by the UI evidence.
4. Retain the before source artifact and timestamp.
5. Execute only the separately authorized bounded no-op or read-only action.
6. Retain evidence excluding concurrent project traffic.
7. Retain the after source artifact and timestamp in the same billing period.
8. Replace the unexecuted template with a private working input that contains no credential or clear project reference.
9. Run the offline verifier with `--require-qualified`.
10. Review the provider delta interval, selected unexplained reserve, safety flags, and output digest before publishing sanitized evidence.

## Current disposition

G3B contract and verifier preparation do not complete G3. G3 remains `unresolved`; revision 4 remains `not_selected`; R5 remains halted.
