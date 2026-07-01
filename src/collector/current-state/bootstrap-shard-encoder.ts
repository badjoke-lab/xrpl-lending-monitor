import type { EncodedBootstrapShard } from './bootstrap-runner'
import type { CurrentStatePage } from './scan-current-state'

export interface CurrentStateShardPayload {
  schemaVersion: 1
  snapshotId: string
  pageNumber: number
  markerBefore: unknown
  markerAfter: unknown
  firstLedgerIndex: string | null
  lastLedgerIndex: string | null
  decodedObjects: number
  vaults: CurrentStatePage['vaults']
  loanBrokers: CurrentStatePage['loanBrokers']
  loans: CurrentStatePage['loans']
}

export function serializeCurrentStateShard(options: {
  page: CurrentStatePage
  snapshotId: string
  pageNumber: number
}): Uint8Array {
  const payload: CurrentStateShardPayload = {
    schemaVersion: 1,
    snapshotId: options.snapshotId,
    pageNumber: options.pageNumber,
    markerBefore: options.page.markerBefore ?? null,
    markerAfter: options.page.markerAfter ?? null,
    firstLedgerIndex: options.page.firstLedgerIndex,
    lastLedgerIndex: options.page.lastLedgerIndex,
    decodedObjects: options.page.decodedObjects,
    vaults: options.page.vaults,
    loanBrokers: options.page.loanBrokers,
    loans: options.page.loans,
  }
  return new TextEncoder().encode(`${JSON.stringify(payload)}\n`)
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function encodeCurrentStatePageGzip(
  page: CurrentStatePage,
  context: { snapshotId: string; pageNumber: number },
): Promise<EncodedBootstrapShard> {
  const serialized = serializeCurrentStateShard({
    page,
    snapshotId: context.snapshotId,
    pageNumber: context.pageNumber,
  })
  return {
    bytes: await gzip(serialized),
    encoding: 'gzip',
  }
}
