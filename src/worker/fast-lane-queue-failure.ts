import { isFastLaneStorageCapacityError } from './repositories/fast-lane-storage-retention'

export type FastLaneQueueFailureDisposition = 'ack' | 'retry'

function failureText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.toLowerCase()
  }
  return String(error).toLowerCase()
}

export function fastLaneQueueFailureDisposition(
  error: unknown,
): FastLaneQueueFailureDisposition {
  if (isFastLaneStorageCapacityError(error)) return 'ack'

  const text = failureText(error)
  if (
    text.includes('exceeded maximum db size')
    || text.includes('capacity guard reached')
    || text.includes('d1 capacity check failed')
    || text.includes('too many subrequests by single worker invocation')
  ) {
    return 'ack'
  }

  return 'retry'
}
