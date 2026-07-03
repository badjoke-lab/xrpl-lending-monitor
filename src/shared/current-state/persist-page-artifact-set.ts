import type { ArtifactMetadata, ArtifactStore } from './artifact-metadata'
import type {
  PageArtifactCheckpoint,
  PageArtifactSet,
} from './page-artifact-types'

function expectedMetadata(
  key: string,
  bytes: Uint8Array,
  sha256: string,
): ArtifactMetadata {
  return { key, size: bytes.byteLength, sha256 }
}

async function assertStored(
  store: ArtifactStore,
  expected: ArtifactMetadata,
): Promise<void> {
  const actual = await store.inspect(expected.key)
  if (!actual) throw new Error(`Missing persisted artifact ${expected.key}`)
  if (actual.size !== expected.size || actual.sha256 !== expected.sha256) {
    throw new Error(`Persisted artifact metadata mismatch for ${expected.key}`)
  }
}

export async function persistPageArtifactSet(options: {
  store: ArtifactStore
  artifactSet: PageArtifactSet
  commitCheckpoint: (checkpoint: PageArtifactCheckpoint) => Promise<void>
}): Promise<PageArtifactCheckpoint> {
  const expected: ArtifactMetadata[] = []

  for (const artifact of options.artifactSet.dataArtifacts) {
    await options.store.write(artifact.key, artifact.bytes, artifact.sha256)
    expected.push(expectedMetadata(artifact.key, artifact.bytes, artifact.sha256))
  }
  for (const artifact of options.artifactSet.indexArtifacts) {
    await options.store.write(artifact.key, artifact.bytes, artifact.sha256)
    expected.push(expectedMetadata(artifact.key, artifact.bytes, artifact.sha256))
  }
  await options.store.write(
    options.artifactSet.manifestKey,
    options.artifactSet.manifestBytes,
    options.artifactSet.manifestSha256,
  )
  expected.push(expectedMetadata(
    options.artifactSet.manifestKey,
    options.artifactSet.manifestBytes,
    options.artifactSet.manifestSha256,
  ))

  for (const artifact of expected) await assertStored(options.store, artifact)

  const checkpoint: PageArtifactCheckpoint = {
    pageSequence: options.artifactSet.manifest.pageSequence,
    markerAfter: options.artifactSet.manifest.markerAfter,
    manifestKey: options.artifactSet.manifestKey,
    manifestSha256: options.artifactSet.manifestSha256,
  }
  await options.commitCheckpoint(checkpoint)
  return checkpoint
}
