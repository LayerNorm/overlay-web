import 'server-only'

import { recordHarnessRequestUsage } from './request-usage'
import type { HarnessExecutionReference } from './state-steps'

export async function admitHarnessRequestUsage(reference: HarnessExecutionReference, modelId: string): Promise<void> {
  'use step'
  await recordHarnessRequestUsage(reference, modelId)
}
