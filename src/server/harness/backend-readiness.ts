import 'server-only'

import type { AppSettings } from '@/shared/app/app-contracts'

/**
 * The web deploys before Convex. The existing settings query carries an additive
 * server-owned capability marker. Production redacts missing-function errors, so
 * errors can never safely indicate readiness. Check before creating an AgentRun.
 */
export function isHarnessBackendReady(settings: AppSettings | null): boolean {
  if (!settings) return false
  if (!('harnessRevision' in settings)) return false
  return settings.harnessRevision === 'overlay-harness-v1'
    && 'harnessModelRecoveryRevision' in settings
    && settings.harnessModelRecoveryRevision === 'settled-retry-v1'
    && 'harnessArtifactPublicationRevision' in settings
    && settings.harnessArtifactPublicationRevision === 'binary-artifact-v1'
    && 'harnessTranscriptRevision' in settings
    && settings.harnessTranscriptRevision === 'settled-public-v1'
    && 'harnessFullTranscriptRevision' in settings
    && settings.harnessFullTranscriptRevision === 'full-public-v1'
}
