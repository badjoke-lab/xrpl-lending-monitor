import type { CurrentStateOverlayMutation } from '../../worker/repositories/current-state-overlay'

export interface SourcedOverlayMutation {
  mutation: CurrentStateOverlayMutation
  ledgerIndex: number
  ledgerHash: string
  transactionHash: string
  transactionIndex: number
  updatedAt: string
}

function mutationKey(entry: SourcedOverlayMutation): string {
  return `${entry.mutation.objectType}:${entry.mutation.objectId}`
}

function compareSource(left: SourcedOverlayMutation, right: SourcedOverlayMutation): number {
  if (left.ledgerIndex !== right.ledgerIndex) return left.ledgerIndex - right.ledgerIndex
  return left.transactionIndex - right.transactionIndex
}

export function coalesceLatestOverlayMutations(
  entries: readonly SourcedOverlayMutation[],
): SourcedOverlayMutation[] {
  const latest = new Map<string, SourcedOverlayMutation>()

  for (const entry of entries) {
    const key = mutationKey(entry)
    const previous = latest.get(key)
    if (!previous || compareSource(previous, entry) < 0) latest.set(key, entry)
  }

  return [...latest.values()].sort(compareSource)
}
