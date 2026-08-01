import {
  computeDeploymentProfileIdentityDigest,
  evaluateDeploymentProfileQualification,
  type DeploymentProfileGateEvidenceV1,
  type DeploymentProfileIdentityV1,
  type DeploymentProfileQualificationDecisionV1,
  type DeploymentProfileQualificationInputV1,
} from './deployment-profile-qualification'

const OBSERVED_AT = '2026-08-01T15:30:00.000Z'

export const R4C1_LOCAL_SQLITE_PROFILE: DeploymentProfileIdentityV1 = {
  schemaVersion: 1,
  profileId: 'self-hosted-sqlite-service',
  revision: 1,
  label: 'Cardless self-hosted SQLite service',
  components: {
    storage: 'sqlite-reference-v1',
    scheduler: 'portable-durable-scheduler-v1',
    execution: 'local-sqlite-supervisor-harness-v1',
    publication: 'sqlite-publication-maintenance-v1',
    maintenance: 'portable-bounded-maintenance-v1',
    completeStateTransfer: 'portable-complete-state-v1',
  },
}

function gateEvidence(options: {
  profileIdentityDigest: string
  gateId: DeploymentProfileGateEvidenceV1['gateId']
  status: DeploymentProfileGateEvidenceV1['status']
  sourceType: DeploymentProfileGateEvidenceV1['sourceType']
  summary: string
  artifacts: string[]
}): DeploymentProfileGateEvidenceV1 {
  return {
    schemaVersion: 1,
    profileId: R4C1_LOCAL_SQLITE_PROFILE.profileId,
    profileRevision: R4C1_LOCAL_SQLITE_PROFILE.revision,
    profileIdentityDigest: options.profileIdentityDigest,
    gateId: options.gateId,
    status: options.status,
    sourceType: options.sourceType,
    summary: options.summary,
    observedAt: OBSERVED_AT,
    artifacts: options.artifacts,
  }
}

export async function buildR4C1LocalSqliteQualificationInput(): Promise<DeploymentProfileQualificationInputV1> {
  const profileIdentityDigest = await computeDeploymentProfileIdentityDigest(
    R4C1_LOCAL_SQLITE_PROFILE,
  )
  const implementationArtifacts = [
    'migrations/10008_local_sqlite_service_supervisor.sql',
    'src/shared/local-sqlite-service-supervisor.ts',
    'src/shared/local-sqlite-service-supervisor.test.ts',
  ]

  return {
    schemaVersion: 1,
    evaluatedAt: OBSERVED_AT,
    profile: R4C1_LOCAL_SQLITE_PROFILE,
    profileIdentityDigest,
    gateEvidence: [
      gateEvidence({
        profileIdentityDigest,
        gateId: 'G1',
        status: 'pass',
        sourceType: 'operator_constraint',
        summary:
          'The local SQLite reference harness requires no paid subscription, payment method, card verification, or prepaid credit.',
        artifacts: ['docs/ops/r4-deployment-profile-qualification-plan-2026-08-01.md'],
      }),
      gateEvidence({
        profileIdentityDigest,
        gateId: 'G2',
        status: 'pass',
        sourceType: 'operator_constraint',
        summary:
          'The local file-backed harness has no provider billing path or automatic paid overage.',
        artifacts: ['docs/ops/r4-deployment-profile-qualification-plan-2026-08-01.md'],
      }),
      gateEvidence({
        profileIdentityDigest,
        gateId: 'G3',
        status: 'pass',
        sourceType: 'local_conformance',
        summary:
          'File-backed SQLite preserves the durable scheduler across process close and reopen, rejects fresh lease theft, and reclaims stale process ownership at exact expiry.',
        artifacts: implementationArtifacts,
      }),
      gateEvidence({
        profileIdentityDigest,
        gateId: 'G4',
        status: 'pass',
        sourceType: 'local_conformance',
        summary:
          'The SQLite reference runtime retains the proven transaction boundary for phase mutation, message completion, and successor reservation.',
        artifacts: [
          'src/shared/portable-collector-adapter-conformance.test.ts',
          'src/shared/portable-collector-scheduler.ts',
        ],
      }),
      gateEvidence({
        profileIdentityDigest,
        gateId: 'G5',
        status: 'pass',
        sourceType: 'local_conformance',
        summary:
          'The SQLite committed reader exposes only finalized rows at an immutable source-bound read fence.',
        artifacts: [
          'src/shared/portable-collector-committed-reader.ts',
          'src/shared/portable-collector-committed-reader.test.ts',
        ],
      }),
      gateEvidence({
        profileIdentityDigest,
        gateId: 'G6',
        status: 'pass',
        sourceType: 'local_conformance',
        summary:
          'Collection, scheduler, publication, and maintenance state export and restore with exact canonical parity; active local process ownership is intentionally host-local and is not transferred.',
        artifacts: [
          'src/shared/portable-collector-complete-state.ts',
          'src/shared/portable-collector-complete-state.test.ts',
        ],
      }),
      gateEvidence({
        profileIdentityDigest,
        gateId: 'G7',
        status: 'unresolved',
        sourceType: 'local_conformance',
        summary:
          'No retained service-managed throughput run yet proves steady p95 above 21 committed ledgers per minute and catch-up above 30.',
        artifacts: ['docs/ops/r4-deployment-profile-qualification-plan-2026-08-01.md'],
      }),
      gateEvidence({
        profileIdentityDigest,
        gateId: 'G8',
        status: 'unresolved',
        sourceType: 'local_conformance',
        summary:
          'Crash, lease, backoff, and terminal halt behavior pass, but CPU, memory, disk, database size, network, and sustained resource stop thresholds are not yet measured.',
        artifacts: implementationArtifacts,
      }),
      gateEvidence({
        profileIdentityDigest,
        gateId: 'G9',
        status: 'unresolved',
        sourceType: 'operator_constraint',
        summary:
          'No actual always-on host, OS service manager, unattended boot restart, automated deploy and rollback, power and network continuity, or off-host evidence retention has been proven.',
        artifacts: ['docs/ops/r4-deployment-profile-qualification-plan-2026-08-01.md'],
      }),
      gateEvidence({
        profileIdentityDigest,
        gateId: 'G10',
        status: 'pass',
        sourceType: 'operator_constraint',
        summary:
          'R4C1 is a local file-backed harness only and performs no production, public-reader, Queue, Cron, Mainnet, recovery, or soak mutation.',
        artifacts: implementationArtifacts,
      }),
    ],
    scorecard: null,
  }
}

export async function evaluateR4C1LocalSqliteProfile(): Promise<DeploymentProfileQualificationDecisionV1> {
  return evaluateDeploymentProfileQualification(
    await buildR4C1LocalSqliteQualificationInput(),
  )
}
