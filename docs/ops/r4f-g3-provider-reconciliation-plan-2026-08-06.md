# R4F G3 provider reconciliation plan

Date: `2026-08-06`.
Controlling issue: `#1261`.
Candidate identity: `supabase_free_postgres_pgcron_edge` revision `4`, digest `39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5`.

## Purpose

G3 compares the application-owned directional billable-egress upper bound with the provider usage surface without inventing precision that the provider does not expose.

This plan does not authorize a provider experiment, migration, Edge deployment, R5 recovery mutation, public-reader cutover, Mainnet, stabilization, or soak.

## Retained capability facts

The prior PAT capability probe established the following boundary:

- project analytics request-count and function-stat endpoints were readable;
- no provider egress-byte field was discovered on those PAT-readable analytics surfaces;
- the organization daily usage surface returned `401` when called with the PAT;
- provider logs did not supply a retained response-byte total suitable for project egress reconciliation;
- therefore exact automated provider-byte reconciliation is currently unavailable.

These facts do not prove that the Dashboard lacks usage data. They prove only that the retained automation surfaces cannot supply an exact egress-byte counter for this qualification.

## G3A — interval contract

`src/shared/supabase-revision4-provider-reconciliation.ts` treats provider observations as intervals:

```text
provider before = [before lower, before upper]
provider after  = [after lower, after upper]

delta lower = max(0, after lower - before upper)
delta upper = max(0, after upper - before lower)
```

A provider display rounded to a unit or presented with limited granularity must be converted to the full byte interval that the displayed value could represent. The displayed number must not be treated as an exact byte counter.

The unexplained-delta reserve is:

```text
new reserve = max(0, provider delta upper - application upper)
selected reserve = max(retained reserve, new reserve)
covered upper = application upper + selected reserve
```

A wider prior reserve is never reduced by one smaller experiment.

The synthetic fixture under `ops/r4f/revision4-provider-reconciliation-fixture.json` tests the arithmetic only. It is explicitly prohibited from satisfying G3.

## G3B — separately authorized bounded capture

A future provider capture may proceed only through a separate authorization that fixes:

- exact project identity without publishing it;
- one billing period and one Dashboard filter;
- the display unit and rounding interpretation used to construct each interval;
- a before observation and an after observation;
- an isolated no-op or read-only candidate action;
- absence of concurrent project traffic during the observation window;
- no counter reset, project switch, period rollover, or scope change;
- exact candidate source commit and profile identity;
- no R5 mutation and no public-reader change.

The experiment must retain sanitized application accounting, provider before/after intervals, interval derivation, source timestamps, and the resulting reserve. Screenshots or operator transcription may be used only when the displayed unit, project filter, time period, and source timestamps remain independently reviewable.

## G3C — decision

G3 may pass by conservative interval reconciliation even when exact automated reconciliation is unavailable, but only when:

1. the capture is a separately authorized bounded provider experiment;
2. before and after refer to the same exact project and billing period;
3. concurrent provider traffic is excluded;
4. no reset or scope change is detected;
5. the application upper bound plus selected unexplained reserve covers the provider delta upper bound;
6. provider granularity is retained as an interval rather than overstated as an exact value;
7. all safety flags remain unchanged.

A passing interval result does not select revision 4 and does not authorize R5. G4 through G10 remain mandatory.

## Fail-closed conditions

G3 remains unresolved when any of the following occurs:

- synthetic input is supplied as provider evidence;
- provider before or after has an invalid interval;
- the after upper bound is below the before lower bound;
- the project or billing period differs;
- concurrent traffic cannot be excluded;
- the Dashboard display unit or rounding rule cannot be bounded;
- the required reserve exceeds the retained resource design and no new qualification is approved;
- provider, production, recovery, public-reader, Mainnet, stabilization, or soak state changes.

## Current disposition

G3A is a planning and arithmetic unit only. G3 remains `unresolved`, revision 4 remains `not_selected`, and Issue `#1175` remains halted.
