# T5 production cutover evidence — 2026-07-10

## Status

The T5 fixed-target recovery cutover completed successfully on XRPL Devnet.

Production is aligned to the T1 replacement base and protected four-hour cadence. M5-5 remains incomplete. M6 has not started.

## T1 immutable and current-state identity

- epoch: `devnet-3371675`;
- replacement snapshot: `devnet-3539657-747554dd57de`;
- replacement ledger: `3539657`;
- replacement ledger hash: `747554DD57DE87C80E55B5936EAE223DA72DE3637DD23A6095A34CAFE1CCAEDB`;
- history chain: `canonical-devnet-3371676-3539657`;
- history publication SHA-256: `71b5766984f7529a7691aa3851470c7706e2087ab03e2c6da30503df9109f8cd`;
- history segment count: `338`;
- history ledger count: `167,982`;
- exact-index manifest SHA-256: `6189ac339d52e32b34cda0ba17710e8ac244e8041e7a8149a715a9b79beda026`;
- exact-index records: `3,969,824`;
- current-state manifest SHA-256: `14b79b84dc67ff2e6e71dc7d1ddf29d0627e546d5748c127ca2319502bbc42cd`.

Exact rehearsed candidate commits:

- history candidate commit: `b620df620326282ce7424afb6dabb055da5841be`;
- current-state candidate commit: `167f181af25eec1d5aaf7cf09608039045f82a52`.

## Pre-cutover gates

Before production writes, the retained evidence passed:

1. production-scale immutable bulk generation and global chain verification;
2. post-bulk T0-to-T1 delta generation;
3. T1 exact-index rebuild;
4. T1 replacement current-state rebuild;
5. remote candidate-pair rehearsal;
6. exact candidate branch HEAD binding;
7. publication and current-state manifest digest binding;
8. fresh production cursor/overlay evidence;
9. live validated head at or ahead of T1;
10. deterministic replacement-base planner action `rebase`;
11. current-day D1 write-headroom gate.

The retained preflight plan used:

- previous cursor ledger: `3502434`;
- previous cursor hash: `EBABB4FEA60A8EB6767E7BA4905FABBB49746E730AE51C51EB9106E4304FD480`;
- previous base ledger: `3432924`;
- previous snapshot: `devnet-3432924-canonical`;
- target ledger: `3539657`.

## Guarded cutover sequence

The successful recovery run used direct read-only D1 evidence to avoid stale stored-head gating before the scheduled network refresh.

Sequence:

1. read `sync_state`, current epoch, and overlay state directly from D1 using SELECT-only queries;
2. capture the live validated Devnet head;
3. run the deterministic fail-closed cutover planner;
4. verify T1 production history source and protected schedule state;
5. temporarily deploy one-minute cadence with the T1 replacement target;
6. wait for the scheduled handler to refresh network state and execute the guarded same-epoch rebase;
7. require replacement-base endpoint state `replayed`;
8. promote the exact rehearsed T1 current-state commit;
9. deploy the T1 target with protected cron `0 */4 * * *`;
10. verify replacement-base, history-source, collector, and Overview production alignment.

Successful workflow run: `29084003423`.
Retained artifact: `8223978844`.

## Final production evidence

The final replacement-base endpoint returned:

- status: `replayed`;
- plan action: `replay`;
- active T1 replacement snapshot: `devnet-3539657-747554dd57de`;
- production cursor: `3539666`;
- production cursor hash: `DFA2BDBCA8EAE4DDB5B8631990F3F87FB8299717A5C1A968A6E03FB556B0C61E`;
- observed head: `3540948`;
- observed head hash: `292709875DCFEC7A4447CCF89778DE1364D6BCAFF49DAE34E8CBF0D77A03E1AA`;
- active epoch: `devnet-3371675`.

The active T1 overlay state was aligned with the live cursor:

- base ledger: `3539657`;
- base hash: `747554DD57DE87C80E55B5936EAE223DA72DE3637DD23A6095A34CAFE1CCAEDB`;
- overlay ledger: `3539666`;
- overlay hash: `DFA2BDBCA8EAE4DDB5B8631990F3F87FB8299717A5C1A968A6E03FB556B0C61E`.

The production history-source endpoint returned:

- status: `ok`;
- mode: `hybrid`;
- chain terminal ledger: `3539657`;
- publication digest: `71b5766984f7529a7691aa3851470c7706e2087ab03e2c6da30503df9109f8cd`;
- exact-index records: `3,969,824`.

The final collector evidence returned:

- status: `behind`;
- cursor: `3539666`;
- observed head: `3540948`;
- lag: `1282` ledgers;
- endpoint: `wss://s.devnet.rippletest.net:51233/`;
- endpoint attempts: `1`;
- consecutive failures: `0`;
- error: `null`;
- run duration: `4173 ms`;
- ledgers committed in the sampled run: `9`;
- persistence rows written in the sampled run: `2621`.

The Cloudflare schedules API confirmed exactly one active schedule:

`0 */4 * * *`

## Interpretation

The production-scale immutable backlog path and guarded cutover path are now proven end to end on Devnet. The system is operating from the T1 replacement base with bounded live-tail continuation.

The collector is not yet current at the retained final sample. The retained lag is `1282` ledgers, so M5-5 production-shaped browser evidence remains blocked until freshness and D1 headroom are re-evaluated.

The next operational unit is live-tail validation and resource measurement from the T1 base. The system must show stable cursor movement, zero collector failures, acceptable D1 burn, and sufficient freshness before M5-5 browser evidence can resume.
