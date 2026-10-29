import 'server-only'

import type { AppSettings } from '@/shared/app/app-contracts'

/**
 * The web deploys before Convex. The existing settings query carries an additive
 * server-owned capability marker. Production redacts missing-function errors, so
 * errors can never safely indicate readiness. Check before creating an AgentRun.
 */
export function isHarnessBackendReady(settings: AppSettings | null): boolean {
  if (!settings) throw new Error('Harness backend readiness could not be determined.')
  if (!('harnessRevision' in settings)) return false
  if (settings.harnessRevision !== 'overlay-harness-v1') throw new Error('Unsupported Harness backend revision.')
  return true
}
