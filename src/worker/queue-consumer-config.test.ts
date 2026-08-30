import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

interface WranglerQueueConsumer {
  queue?: string
  max_batch_size?: number
  max_batch_timeout?: number
  max_retries?: number
  max_concurrency?: number
}

interface WranglerConfig {
  queues?: {
    consumers?: WranglerQueueConsumer[]
  }
}

describe('production Queue consumer config', () => {
  it('keeps Current serial and allows bounded transient retry endurance', () => {
    const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8')) as WranglerConfig
    const consumer = config.queues?.consumers?.find(
      (item) => item.queue === 'xrpl-lending-fast-lane',
    )

    expect(consumer).toMatchObject({
      queue: 'xrpl-lending-fast-lane',
      max_batch_size: 1,
      max_batch_timeout: 1,
      max_retries: 100,
      max_concurrency: 1,
    })
  })
})
