import type { LiveContinuationEvidence } from '../../collector/incremental/live-continuation-verification'
import type { ManagedTransitionSourceDiagnostics } from '../repositories/managed-transition-source-diagnostics'
import { managedTransitionPath } from './managed-transition-path'

export function managedRuntimePaths(
  evidence: LiveContinuationEvidence,
  source: ManagedTransitionSourceDiagnostics,
) {
  return {
    impaired: managedTransitionPath(source.impaired, evidence.lifecycle.impaired, 'impaired'),
    unimpaired: managedTransitionPath(source.unimpaired, evidence.lifecycle.unimpaired, 'unimpaired'),
    defaulted: managedTransitionPath(source.defaulted, evidence.lifecycle.defaulted, 'defaulted'),
  }
}
