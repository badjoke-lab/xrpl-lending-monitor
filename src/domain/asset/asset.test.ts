import { describe, expect, it } from 'vitest'

import { serializeCanonicalAmount } from '../../worker/serializers/asset'
import {
  addCanonicalAmounts,
  normalizeXrplAmount,
  normalizeXrplAsset,
} from './amount'
import {
  addExactDecimals,
  formatExactDecimal,
  parseExactDecimal,
} from './decimal'
import { createIouAsset, createMptAsset, XRP_ASSET } from './identity'
import { resolveMptAsset } from './mpt-metadata'
import { normalizeTenthsBasisPointRate } from './rates'

const MPT_ID = '000004C463C52827307480341125DA0577DEFC38405B0E3E'

function toHex(value: unknown): string {
  return Array.from(new TextEncoder().encode(JSON.stringify(value)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

describe('exact decimal arithmetic', () => {
  it('normalizes exponent notation and adds without binary floating point', () => {
    expect(formatExactDecimal(parseExactDecimal('1.20e-3'))).toBe('0.0012')
    expect(
      formatExactDecimal(
        addExactDecimals(parseExactDecimal('0.1'), parseExactDecimal('0.2')),
      ),
    ).toBe('0.3')
  })
})

describe('canonical asset identity', () => {
  it('keeps XRP, IOU issuers, and MPT issuance IDs distinct', () => {
    const first = createIouAsset('USD', 'rFirstIssuer')
    const second = createIouAsset('USD', 'rSecondIssuer')
    const mpt = createMptAsset(MPT_ID.toLowerCase())

    expect(XRP_ASSET.key).toBe('XRP')
    expect(first.key).toBe('IOU:USD:rFirstIssuer')
    expect(second.key).toBe('IOU:USD:rSecondIssuer')
    expect(first.key).not.toBe(second.key)
    expect(mpt.key).toBe(`MPT:${MPT_ID}`)
  })

  it('normalizes 160-bit currency codes without changing 3-character identity', () => {
    expect(
      createIouAsset('015841551A748AD2C1F76FF6ECB0CCCD00000000'.toLowerCase(), 'rIssuer')
        .currency,
    ).toBe('015841551A748AD2C1F76FF6ECB0CCCD00000000')
    expect(createIouAsset('usd', 'rIssuer').currency).toBe('usd')
  })
})

describe('XRPL amount normalization', () => {
  it('converts XRP drops to an exact six-decimal display amount', () => {
    expect(normalizeXrplAmount('1000001')).toMatchObject({
      asset: { type: 'xrp', key: 'XRP' },
      raw: '1000001',
      display: '1.000001',
      provenance: 'direct',
    })
  })

  it('normalizes IOU values and adds only identical currency-and-issuer pairs', () => {
    const first = normalizeXrplAmount({
      currency: 'USD',
      issuer: 'rIssuerOne',
      value: '1e-3',
    })
    const second = normalizeXrplAmount({
      currency: 'USD',
      issuer: 'rIssuerOne',
      value: '0.002',
    })
    const otherIssuer = normalizeXrplAmount({
      currency: 'USD',
      issuer: 'rIssuerTwo',
      value: '1',
    })

    expect(addCanonicalAmounts(first, second)).toMatchObject({
      raw: '0.003',
      display: '0.003',
      provenance: 'derived',
    })
    expect(() => addCanonicalAmounts(first, otherIssuer)).toThrow(
      'Cannot combine unlike assets',
    )
  })

  it('uses MPT AssetScale and preserves identity when metadata is missing', () => {
    const unresolved = resolveMptAsset(MPT_ID)
    const amount = normalizeXrplAmount(
      { mpt_issuance_id: MPT_ID, value: '10000000' },
      { mptAsset: { ...unresolved, scale: 6 } },
    )

    expect(amount).toMatchObject({
      asset: {
        type: 'mpt',
        key: `MPT:${MPT_ID}`,
        metadataSource: 'none',
      },
      raw: '10000000',
      display: '10.000000',
    })
  })

  it('normalizes asset descriptors without an amount', () => {
    expect(normalizeXrplAsset({ currency: 'XRP' })).toEqual(XRP_ASSET)
    expect(normalizeXrplAsset({ currency: 'EUR', issuer: 'rEuroIssuer' })).toMatchObject({
      key: 'IOU:EUR:rEuroIssuer',
    })
    expect(normalizeXrplAsset({ mpt_issuance_id: MPT_ID })).toMatchObject({
      key: `MPT:${MPT_ID}`,
    })
  })
})

describe('MPT metadata resolution', () => {
  it('decodes ledger metadata, scale, transfer fee, and immutable properties', () => {
    const asset = resolveMptAsset(MPT_ID, {
      LedgerEntryType: 'MPTokenIssuance',
      Issuer: 'rMptIssuer',
      AssetScale: 6,
      TransferFee: 500,
      Flags: 0x00000065,
      MPTokenMetadata: toHex({ ticker: 'AUDT', name: 'Audit Token' }),
    })

    expect(asset).toMatchObject({
      key: `MPT:${MPT_ID}`,
      issuer: 'rMptIssuer',
      ticker: 'AUDT',
      name: 'Audit Token',
      scale: 6,
      metadataSource: 'ledger',
      transferFeeTenthsBasisPoints: 500,
      properties: {
        globallyLocked: true,
        requiresAuthorization: true,
        canTransfer: true,
        canClawback: true,
      },
    })
  })

  it('accepts compact XLS-89 metadata keys and marks malformed blobs invalid', () => {
    expect(
      resolveMptAsset(MPT_ID, {
        LedgerEntryType: 'MPTokenIssuance',
        Flags: 0,
        MPTokenMetadata: toHex({ t: 'TBILL', n: 'Treasury Bill Token' }),
      }),
    ).toMatchObject({
      ticker: 'TBILL',
      name: 'Treasury Bill Token',
      metadataSource: 'ledger',
    })

    expect(
      resolveMptAsset(MPT_ID, {
        LedgerEntryType: 'MPTokenIssuance',
        Flags: 0,
        MPTokenMetadata: 'NOT-HEX',
      }).metadataSource,
    ).toBe('invalid')
  })
})

describe('rate and API serialization', () => {
  it('converts tenths of a basis point exactly', () => {
    expect(normalizeTenthsBasisPointRate(500)).toEqual({
      rawTenthsBasisPoints: 500,
      basisPoints: '50.0',
      percent: '0.500',
      fraction: '0.00500',
    })
  })

  it('serializes canonical asset identity separately from display metadata', () => {
    const asset = resolveMptAsset(MPT_ID, {
      LedgerEntryType: 'MPTokenIssuance',
      Issuer: 'rMptIssuer',
      AssetScale: 2,
      Flags: 0x20,
      MPTokenMetadata: toHex({ ticker: 'TOK', name: 'Token' }),
    })
    const response = serializeCanonicalAmount(
      normalizeXrplAmount(
        { mpt_issuance_id: MPT_ID, value: '1234' },
        { mptAsset: asset },
      ),
    )

    expect(response).toMatchObject({
      asset: {
        type: 'mpt',
        key: `MPT:${MPT_ID}`,
        mpt_issuance_id: MPT_ID,
        ticker: 'TOK',
        scale: 2,
        properties: { can_transfer: true },
      },
      amount: {
        raw: '1234',
        display: '12.34',
        provenance: 'direct',
      },
    })
  })
})
