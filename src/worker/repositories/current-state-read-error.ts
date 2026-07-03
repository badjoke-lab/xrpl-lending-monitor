export class CurrentStateObjectReadError extends Error {
  readonly code:
    | 'invalid_cursor'
    | 'snapshot_manifest_unavailable'
    | 'manifest_integrity_error'
    | 'shard_integrity_error'
    | 'relationship_read_limit'

  constructor(code: CurrentStateObjectReadError['code'], message: string) {
    super(message)
    this.name = 'CurrentStateObjectReadError'
    this.code = code
  }
}
