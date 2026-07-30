import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

async function wranglerConfig(): Promise<Record<string, unknown>> {
  const source = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
  return JSON.parse(source) as Record<string, unknown>
}

describe('P0 production configuration guard', () => {
  it('keeps cron disabled', async () => {
    const config = await wranglerConfig()
    expect(config.triggers).toEqual({ crons: [] })
  })

  it('keeps the qualified replacement base identity unchanged', async () => {
    const config = await wranglerConfig()
    const vars = config.vars as Record<string, string>
    expect(vars.REPLACEMENT_BASE_SNAPSHOT_ID).toBe('devnet-4039102-4298500c53ba')
    expect(vars.REPLACEMENT_BASE_LEDGER_INDEX).toBe('4039102')
    expect(vars.REPLACEMENT_BASE_LEDGER_HASH).toBe(
      '4298500C53BA7928D6E85E7AA2AD3429ECCA9E9AFA0BB092033B08184BDF93B5',
    )
  })
})
