import { describe, expect, it } from 'vitest'

import { buildDbLessCurrentOverlayGenerationProvenance } from './current-overlay-provenance'

describe('D4 bounded generation provenance', () => {
  it('produces the same digest for full folding and incremental extension', async () => {
    const seed = await buildDbLessCurrentOverlayGenerationProvenance({
      generationIds: ['g1', 'g2'],
    })
    const incremental = await buildDbLessCurrentOverlayGenerationProvenance({
      generationIds: ['g3', 'g4'],
      seed,
    })
    const full = await buildDbLessCurrentOverlayGenerationProvenance({
      generationIds: ['g1', 'g2', 'g3', 'g4'],
    })

    expect(incremental).toEqual(full)
    expect(full).toMatchObject({
      scheme: 'rolling-sha256-v1',
      generationCount: 4,
      firstGenerationId: 'g1',
      lastGenerationId: 'g4',
    })
    expect(full.digestSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects duplicate generation IDs inside one extension batch', async () => {
    await expect(buildDbLessCurrentOverlayGenerationProvenance({
      generationIds: ['g1', 'g1'],
    })).rejects.toThrow('duplicate new generation IDs')
  })
})
