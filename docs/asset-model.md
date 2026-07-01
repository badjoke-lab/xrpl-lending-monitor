# Asset model

## Supported asset classes

### XRP

Canonical identity:

```text
asset_type = xrp
asset_key = XRP
```

Ledger amounts are stored as exact integer drops. API display values use six decimal places because one XRP is one million drops.

### IOU

Canonical identity:

```text
asset_type = iou
asset_key = IOU:<currency>:<issuer>
```

Required fields:

- currency;
- issuer;
- raw amount value;
- display label.

Two IOUs with the same currency code but different issuers are different assets. Three-character codes preserve their ledger identity. Forty-character hexadecimal currency codes are normalized to uppercase hexadecimal without changing their bytes.

### MPT

Canonical identity:

```text
asset_type = mpt
asset_key = MPT:<mpt_issuance_id>
```

The issuance ID is normalized to uppercase hexadecimal. Metadata never changes canonical identity.

Resolved fields where available:

- MPT issuance ID;
- issuer;
- ticker;
- name;
- AssetScale;
- metadata source;
- transfer fee in tenths of a basis point;
- global lock, lock capability, authorization requirement, escrow capability, trade capability, transfer capability, and clawback capability.

Metadata absence or malformed metadata must not prevent the asset from being displayed by issuance ID. The default scale is zero when the ledger entry does not provide `AssetScale`.

## Accepted XRPL shapes

### XRP amount

```json
"1000001"
```

Normalized display: `1.000001 XRP`.

### IOU amount

```json
{
  "currency": "USD",
  "issuer": "r...",
  "value": "1.25e3"
}
```

The value is parsed as an exact decimal string, including exponent notation.

### MPT amount

```json
{
  "mpt_issuance_id": "0000...ABCD",
  "value": "10000000"
}
```

The value is an exact integer and the display decimal point comes from the resolved `AssetScale`.

### Asset descriptor without an amount

- XRP: `{ "currency": "XRP" }`
- IOU: `{ "currency": "USD", "issuer": "r..." }`
- MPT: `{ "mpt_issuance_id": "..." }`

## Prohibited aggregation

Do not sum unlike assets.

Prohibited examples:

- XRP + RLUSD + MPT as one quantity;
- different IOU issuers under one currency total without issuer-aware grouping;
- different MPT issuance IDs under one ticker;
- a USD TVL without a documented and timestamped price source.

Allowed examples:

```text
XRP: 1,250,000 XRP
RLUSD issued by r...: 430,000 RLUSD
MPT 0000...ABCD: 100,000 units
```

All addition operations must compare canonical `asset_key` values first and fail when they differ.

## Amount representation

Canonical handling:

- preserve the raw amount string;
- store asset identity separately;
- never use binary floating point for canonical arithmetic;
- parse decimal values into an integer coefficient and decimal scale;
- use `BigInt` for exact coefficient arithmetic;
- retain MPT AssetScale and XRP drop scale;
- normalize exponent notation deterministically.

API representation:

```json
{
  "asset": {
    "type": "mpt",
    "key": "MPT:...",
    "mpt_issuance_id": "...",
    "ticker": "AUDT",
    "scale": 6,
    "metadata_source": "ledger"
  },
  "amount": {
    "raw": "10000000",
    "display": "10.000000",
    "provenance": "direct"
  }
}
```

Friendly labels, ticker symbols, and names are presentation metadata and are never used as canonical keys.

## MPT metadata resolution

Resolution order:

1. direct Vault or transaction asset identity;
2. matching `MPTokenIssuance` ledger entry;
3. decoded on-ledger `MPTokenMetadata` JSON;
4. fallback raw issuance identity.

The metadata decoder accepts the long XLS-89 keys such as `ticker` and `name` and their compact equivalents `t` and `n`. Invalid hexadecimal, invalid UTF-8, or non-object JSON is recorded as `metadata_source = invalid` rather than changing or dropping the asset.

## Rate representation

Lending interest, cover, management, and applicable transfer-fee rates use tenths of a basis point.

The normalization layer exposes the same integer as:

- raw tenths of a basis point;
- basis points;
- percent;
- fraction.

Example:

```text
raw = 500
basis_points = 50.0
percent = 0.500
fraction = 0.00500
```

Conversions use exact scaled integers, not floating-point arithmetic.

## Ripple epoch representation

Ripple epoch timestamps are unsigned integer seconds since `2000-01-01T00:00:00Z`. The normalization layer converts between Ripple epoch seconds, Unix seconds, `Date`, and ISO 8601 while preserving whole-second identity.

## Asset-separated aggregates

All aggregate tables and APIs group by:

```text
network + epoch_id + asset_key
```

Required aggregate measures may include:

- AssetsTotal;
- AssetsAvailable;
- DebtTotal;
- CoverAvailable;
- LossUnrealized;
- Vault count;
- Broker count;
- Loan count.

## Implementation modules

- `src/domain/asset/identity.ts` — canonical XRP, IOU, and MPT keys;
- `src/domain/asset/decimal.ts` — exact decimal parsing and arithmetic;
- `src/domain/asset/amount.ts` — XRPL amount and asset descriptor normalization;
- `src/domain/asset/mpt-metadata.ts` — issuance metadata and property resolution;
- `src/domain/asset/rates.ts` — tenths-of-basis-point conversion;
- `src/domain/time/ripple-epoch.ts` — timestamp conversion;
- `src/worker/serializers/asset.ts` — API-safe serialization.

## Future price layer

A price layer is outside the initial release. Adding it requires:

- a new specification;
- source-quality rules;
- timestamp and staleness handling;
- price provenance;
- stablecoin depeg handling;
- user-visible separation between native quantity and converted value;
- measured runtime, storage, and API impact analysis.
