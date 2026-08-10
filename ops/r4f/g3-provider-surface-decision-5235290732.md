## Forced free-tier feasibility decision after bounded G3

The bounded provider-isolation path is closed without another live G3 attempt. The retained fresh Usage interval (`5232434512` -> `5232614780`) is valid, but provider logs prove the 42-minute refresh window contains normal collector traffic (`38` other Edge Function requests and `164` other network requests). Supabase Usage is displayed at `0.001 GB` precision and the provider log surface does not expose response bytes, so the one-shot provider egress delta cannot be isolated from this surface.

This is therefore treated as **provider-surface unqualifiable**, not as a reason to pause and rerun again.

Current free-tier decision from retained evidence:

- current Database Size: `0.393 GB`; current Free quota: `500 MB` -> approximately `78.6%` used / `107 MB` display headroom;
- current Egress: `0.134 GB`; Free quota: `5 GB` -> approximately `2.68%` used;
- current Edge Function Invocations: `19,570`; Free quota: `500,000` -> approximately `3.91%` used;
- retained all-function resource baseline projected `115,227` invocations/31d;
- revision-4 R5 steady cadence adds `89,280` invocations/31d -> conservative combined planning total `204,507` (`40.90%` of 500k; `295,493` headroom);
- revision-4 catch-up cadence adds `133,920` -> conservative combined planning total `249,147` (`49.83%`; `250,853` headroom);
- steady throughput is already network-proven at `24 ledgers/min` against required `21/min` (`14.29%` margin);
- revision-4 bounded catch-up cadence is `36/min` against required `30/min` (`20%` margin), while retained catch-up capacity evidence is far above that floor;
- unchanged internal egress halt is `4 GiB/31d`; at required `21 ledgers/min` this requires <= `4,581` whole billable bytes/ledger on average.

**Disposition:** current operation is inside the Free quotas, throughput/catch-up/invocation feasibility passes, but sustained full R5 recovery cannot yet be declared Free-tier-qualified because (1) exact production-shaped revision-4 billable egress per 12-ledger claim is not retained, and (2) Database Size is already the tightest quota at ~78.6% of the Free limit.

Next engineering work is implementation/resource optimization, not another provider qualification loop: attribute and remove duplicate/intermediate operational storage without changing user-visible history/retention, and derive the exact revision-4 completion/request egress from the existing runtime/persisted work shape. No user-visible specification reduction is authorized by this decision.

No R5 mutation, deployment, public-reader change, Mainnet action, stabilization, soak, or new G3 pause is authorized by this comment.