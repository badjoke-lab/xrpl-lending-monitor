# R4C3 exit and R5 entry — 2026-08-03

## Controlling profile

- profile: `supabase_free_postgres_pgcron_edge`
- revision: `3`
- identity digest: `3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67`
- R4B classification: `qualified_candidate`
- R4B gates: `10 pass / 0 fail / 0 unresolved`
- R4E outcome: `profile_selected`

## Controlling remote evidence

- workflow run: `30817518929`
- source commit: `01fc146dcd261d2e919c614130ee19566ca854ae`
- artifact: `8857796228`
- artifact digest: `sha256:5ad18831e32c0dd3b87e7135909a38302b21a01274b112545ea15e259270813c`
- verified at: `2026-08-03T13:34:13.723Z`

The run completed six consecutive guarded minute buckets and committed exactly 144 real Devnet ledgers. All six revision-3 accounting attempts were safe. All seven injected accounting failures were rejected before completion without guarded-state or active-profile mutation.

Revision 3 does not claim unavailable provider peak-memory or provider-egress counters. It qualifies G8 through conservative application-owned upper bounds, crash reservations, rolling 31-day accounting, precommit enforcement, and quota-state transfer parity.

## R5 authorization

R5 recovery is authorized only by `r4e-deployment-profile-selection-2026-08-03.json`.

R5 objective:

1. recover the selected revision-3 profile from the retained checkpoint;
2. continue through the standard phase chain;
3. close Devnet lag to zero;
4. prove recovery convergence and resource accounting continuity;
5. prepare a separate stabilization decision.

## Still prohibited

- public-reader cutover
- Mainnet
- stabilization
- soak
- retired Cloudflare collector restart

Those boundaries require later explicit records. R4C3 qualification and R4E selection do not change them.
