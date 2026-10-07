# XRPL.to shadow provider lane

Status: **implementation isolated from the active Devnet runtime**  
Lane issue: **#1740**  
Partner application: **submitted 2026-10-07; approval pending**

## Scope

This document describes the XRPL.to provider experiment only.

It does not change the active product target, which remains XRPL Devnet, and it does not authorize Mainnet activation.

The current direct-XRPL collector remains the canonical runtime path.

## Provider boundary

The shadow lane introduces one narrow provider contract:

```ts
interface XrplReadProvider {
  readonly kind: 'direct' | 'xrplto'
  readonly endpoint: string
  call<T>(method: string, params?: Record<string, unknown>): Promise<T>
}
```

Implementations:

- `DirectXrplReadProvider` — wraps the existing `XrplJsonRpcClient` request contract;
- `XrplToReadProvider` — uses the XRPL.to `{ method, params }` envelope and unwraps the provider response before returning the XRPL node result.

The domain and validated-ledger parser do not know which provider produced the response.

## Runtime isolation

The existing `readValidatedLedger(...)` function still constructs a direct provider from the configured direct endpoint.

A new `readValidatedLedgerFromProvider(...)` entry point exists only so an isolated shadow caller can exercise the same canonical parser with another provider.

No active scheduler, D3 channel, D4 channel, static UI source, Release publication path, or Devnet endpoint is changed by this lane.

## XRPL.to transport rules encoded in the adapter

The XRPL.to provider:

- sends a descriptive User-Agent;
- sends the API key only through `X-Api-Key` when a key is supplied;
- never places the key in the request body;
- maps HTTP 429 to the repository's `XrplRpcError` with code `rate_limited`;
- retains `Retry-After` as error evidence;
- validates the XRPL.to outer `success` flag and method echo;
- returns only the inner XRPL node `result` to downstream code.

## Evidence inherited from the qualification lane

Free-key Testnet qualification in PR #1742 already established:

- exact validated-ledger semantic parity;
- 100-ledger catch-up parity;
- 1,000-ledger catch-up parity;
- JSON `ledger_data` parity;
- binary `ledger_data` parity.

The current classification remains:

**SECONDARY / PARTNER-GATED**

Free-key throughput did not justify promotion to `PRIMARY_CANDIDATE`.

## Shadow-provider validation

The provider implementation is required to pass:

- direct request-shape regression;
- XRPL.to request-envelope regression;
- User-Agent and API-key placement regression;
- 429 / `Retry-After` normalization;
- provider-neutral validated-ledger parser regression;
- repository lint;
- repository typecheck;
- repository unit tests;
- repository end-to-end tests;
- repository build.

## Gates that remain closed

Partner application submission does not satisfy any of the following by itself:

- Partner approval;
- Partner-tier performance qualification;
- Mainnet approval for this product;
- Lending-specific live-object parity;
- permission to redistribute stored XRPL.to-derived data;
- activation of XRPL.to as a canonical provider.

Do not merge an activation change while any required gate remains open.
