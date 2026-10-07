# XRPL.to Testnet qualification

Status: **X1–X4 Free-key evidence collected; Partner qualification pending**  
Lane issue: **#1740**  
Runtime effect: **none**

## Purpose

This lane evaluates XRPL.to independently from the active direct-XRPL Devnet runtime.

It asks whether XRPL.to can preserve the repository's validated-ledger semantics, whether its read path can support bounded catch-up and state traversal, and whether it is competitive enough to become a future Mainnet provider.

Nothing in this lane changes the active D3/D4 Devnet channels or makes XRPL.to a canonical runtime dependency.

## X1 — Transport and API compatibility

Initial qualification evidence: Actions run `37262172730`.

Observed successfully through `https://api.xrpl.to/v1/testnet`:

- fixtures and health;
- `server_info`;
- `feature`;
- exact validated `ledger` with `transactions=true` and `expand=true`;
- `ledger_data` marker pagination;
- type-filtered `ledger_data` requests for `Vault`, `LoanBroker`, and `Loan`.

The expanded-ledger response contains the shapes already understood by the repository parser, including `tx_json`, `meta`, transaction hash, ledger identity, and validation state.

The first request using Node's generic default User-Agent received a non-JSON HTTP 403. Supplying a descriptive project User-Agent resolved the observed transport failure.

### Observed Testnet amendment state

The X1 `feature` response reported:

- `LendingProtocol`: supported=true, enabled=false;
- `LendingProtocolV1_1`: supported=true, enabled=false;
- `SingleAssetVault`: supported=true, enabled=false;
- `DynamicMPT`: supported=true, enabled=false;
- `MPTokensV1`: supported=true, enabled=true;
- `PriceOracle`: supported=true, enabled=true.

No live Lending/Vault fixture was available. Therefore Lending-specific live-object parity remains unqualified on this Testnet even though generic validated-ledger parity is well proven.

## X2 — Canonical parser parity

Actions run: `37262008027`

The probe reused:

`src/collector/incremental/validated-ledger-parser.ts`

Exact ledger:

- ledger `21,289,389`;
- direct comparison source `https://s.altnet.rippletest.net:51234/`;
- 24 transactions on both paths.

Equal on both paths:

- ledger index;
- ledger hash;
- parent hash;
- close time;
- transaction count and transaction-hash order;
- canonical normalized semantic SHA-256.

Semantic SHA-256:

`6c68c0566650e1abdae8d84c31ff24c0496544da458df5ed5740b92e2922a932`

Result: **PASS**.

## X3 — Anonymous contiguous benchmark

Actions run: `37262172730`

Range:

`21,289,399 → 21,289,428`

Results:

- 30 contiguous ledgers;
- 412 transactions per path;
- semantic mismatches: `0`;
- all canonical semantic digests equal.

Anonymous XRPL.to was deliberately paced to avoid overrunning the no-key request window:

- wall time: `76,675.725 ms`;
- effective rate: `0.391 req/s`;
- p50: `474.281 ms`;
- p95: `701.143 ms`.

Direct Testnet with a window of 16:

- wall time: `1,257.545 ms`;
- effective rate: `23.856 req/s`.

This was not treated as a Partner-tier comparison.

## X4 — Free-key bounded catch-up

The repository secret `XRPLTO_API_KEY` is used only in the `X-Api-Key` request header. It is not written to logs or evidence artifacts.

### X4a — 100-ledger keyed run

Actions run: `37629991522`

XRPL.to used a bounded read window of 4; the direct comparison path used the existing window of 16.

Results:

- ledgers compared: `100`;
- semantic mismatches: `0`;
- aggregate transactions: `1,477` on each path.

XRPL.to:

- wall time: `15,533.592 ms`;
- effective rate: `6.438 req/s`;
- p50: `490.055 ms`;
- p95: `691.228 ms`;
- mean: `512.470 ms`.

Direct:

- wall time: `2,884.823 ms`;
- effective rate: `34.664 req/s`;
- p50: `84.574 ms`;
- p95: `1,021.364 ms`;
- mean: `214.473 ms`.

Result: **PASS for correctness; XRPL.to Free-key is materially slower for catch-up.**

### X4b — 1,000-ledger keyed run

Actions run: `37630202743`

Range:

`21,350,257 → 21,351,256`

Results:

- ledgers compared: `1,000`;
- aggregate transactions: `13,750` on each path;
- semantic mismatches: `0`;
- all semantic digests equal.

XRPL.to, window 4:

- wall time: `181,585.062 ms` (~3.03 minutes);
- effective rate: `5.507 req/s`;
- p50: `533.969 ms`;
- p95: `711.579 ms`;
- mean: `576.149 ms`;
- response bytes: `35,083,241`.

Direct, window 16:

- wall time: `8,609.289 ms`;
- effective rate: `116.154 req/s`;
- p50: `53.613 ms`;
- p95: `56.899 ms`;
- mean: `62.878 ms`;
- response bytes: `34,860,241`.

Observed XRPL.to response headers at the end of the run included:

- `x-ratelimit-limit: 20`;
- `x-ratelimit-remaining: 12`;
- `x-ratelimit-reset: 1`;
- `x-ratelimit-daily-remaining: 31999`.

The `20` header is treated as an observed short-window/burst value, not as proof of the plan's sustained request rate.

Result: **PASS for correctness and bounded completion. Free-key XRPL.to is not competitive with direct Testnet for high-throughput catch-up.**

## X4 — ledger_data parity and throughput

### JSON traversal

Actions run: `37631052669`

Target ledger: `21,351,368`  
Mode: `binary=false`, page limit `256`, 100 pages.

Both paths returned:

- 100 pages;
- 25,600 rows;
- the same continuation marker after page 100;
- the same ledger hash;
- the same first and last object index;
- the same canonical row digest.

XRPL.to:

- wall time: `83,136.231 ms`;
- rows/sec: `307.928`;
- p50: `571.276 ms`;
- p95: `845.154 ms`.

Direct:

- wall time: `4,710.027 ms`;
- rows/sec: `5,435.213`;
- p50: `24.322 ms`;
- p95: `26.603 ms`.

Result: **PASS for parity; JSON bulk traversal is too slow to prefer over direct.**

### Binary traversal

Actions run: `37631531542`

Target ledger: `21,351,432`  
Mode: `binary=true`, page limit `2048`, 100 pages.

Both paths returned:

- 100 pages;
- 204,800 rows;
- the same continuation marker;
- the same ledger hash;
- the same first and last object index;
- the same canonical binary-row digest.

Digest:

`9ef43fc9eef43a1377c4e222210d6b50ec95f5e232420d51f6fdc2f45991057c`

XRPL.to:

- wall time: `76,614.411 ms`;
- rows/sec: `2,673.126`;
- p50: `508.661 ms`;
- p95: `1,166.503 ms`;
- response bytes: `62,131,768`.

Direct:

- wall time: `19,655.368 ms`;
- rows/sec: `10,419.545`;
- p50: `97.740 ms`;
- p95: `103.335 ms`;
- response bytes: `62,108,958`.

Result: **PASS for parity. Binary traversal is the only credible XRPL.to bulk-scan candidate observed so far, but the Free-key path remained about 3.9x slower by wall time than direct in this bounded sample.**

Neither JSON nor binary run exhausted the full Testnet state within the 100-page bound. They are bounded throughput/parity measurements, not complete-ledger traversals.

## Current classification

**SECONDARY / PARTNER-GATED**

Evidence now supports all of the following:

- transport/API compatibility: PASS;
- canonical validated-ledger parser compatibility: PASS;
- 100-ledger Free-key catch-up parity: PASS;
- 1,000-ledger Free-key catch-up parity: PASS;
- 1,000-ledger run semantic mismatches: `0`;
- JSON `ledger_data` parity across 25,600 rows: PASS;
- binary `ledger_data` parity across 204,800 rows: PASS;
- Free-key throughput: materially slower than the independent direct Testnet source;
- Lending-specific live-object parity: still unavailable because the observed Testnet has Lending/Vault amendments disabled;
- Partner-tier throughput: unmeasured;
- redistribution permission: not yet obtained.

Therefore XRPL.to is **not** promoted to `PRIMARY_CANDIDATE` from Free-key evidence.

It is technically credible as a secondary/fallback provider and is semantically compatible with the current parser over the tested data.

## Bulk-read implication

If XRPL.to is later qualified for a Mainnet/base-building role, `ledger_data binary=true` plus local decode should be the first bulk-read design tested.

The observed page capacity was eight times the JSON limit used in this qualification (2048 versus 256), and XRPL.to throughput improved from about 308 rows/sec to about 2,673 rows/sec.

This is an optimization candidate only. It does not change the current Devnet collector.

## Workflows after qualification

To avoid accidental credit/request consumption, the qualification workflows are manual-only after the evidence runs:

- `.github/workflows/xrplto-testnet-probe.yml`
- `.github/workflows/xrplto-keyed-benchmark.yml`
- `.github/workflows/xrplto-ledger-data-benchmark.yml`

## Remaining gates

The next useful XRPL.to evidence is no longer another Free-key benchmark.

Remaining gates are:

1. Partner application and approval;
2. a valid public attribution/credit URL for the Partner review;
3. explicit written permission for any planned stored-data redistribution that falls under XRPL.to's restriction;
4. Partner-tier rerun of bounded 100/1,000-ledger catch-up with a higher, policy-compliant read window;
5. Partner-tier binary `ledger_data` benchmark;
6. future Mainnet qualification before any canonical provider role;
7. Lending-specific parity once a network/provider combination exposes active Lending/Vault data.

No public XRPL.to-backed canonical artifacts are activated by this work.

## Evidence links

- X1/X3 qualification: https://github.com/badjoke-lab/xrpl-lending-monitor/actions/runs/37262172730
- X2 exact parity: https://github.com/badjoke-lab/xrpl-lending-monitor/actions/runs/37262008027
- X4 keyed 100-ledger: https://github.com/badjoke-lab/xrpl-lending-monitor/actions/runs/37629991522
- X4 keyed 1,000-ledger: https://github.com/badjoke-lab/xrpl-lending-monitor/actions/runs/37630202743
- X4 JSON ledger_data: https://github.com/badjoke-lab/xrpl-lending-monitor/actions/runs/37631052669
- X4 binary ledger_data: https://github.com/badjoke-lab/xrpl-lending-monitor/actions/runs/37631531542
- lane issue: https://github.com/badjoke-lab/xrpl-lending-monitor/issues/1740
