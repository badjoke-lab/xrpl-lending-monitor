import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('canonical overlay selection after checkpoint cutover', () => {
  it('selects the newest base when old and new overlay states coexist', () => {
    const source = readFileSync(new URL('./fast-lane-canonical-bridge.ts', import.meta.url), 'utf8')
    expect(source).toMatch(
      /FROM current_state_overlay_state\s+WHERE network = 'devnet'\s+ORDER BY base_ledger_index DESC, updated_at DESC\s+LIMIT 1/,
    )
  })
})
