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
}
