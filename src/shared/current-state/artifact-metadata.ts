export type ArtifactMetadata = {
  key: string
  size: number
  sha256: string
}

export interface ArtifactStore {
  write(key: string, bytes: Uint8Array, sha256: string): Promise<void>
  read(key: string): Promise<Uint8Array | null>
  inspect(key: string): Promise<ArtifactMetadata | null>
  enumerate(prefix: string): Promise<ArtifactMetadata[]>
}
