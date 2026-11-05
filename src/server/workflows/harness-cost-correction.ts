import 'server-only'

import { start } from 'workflow/api'
import { correctHarnessModelCost, type HarnessCostCorrection } from '@/server/harness/cost-correction-step'

export async function harnessCostCorrectionWorkflow(input: HarnessCostCorrection): Promise<void> {
  'use workflow'
  await correctHarnessModelCost(input)
}

export async function startHarnessCostCorrection(input: HarnessCostCorrection): Promise<void> {
  await start(harnessCostCorrectionWorkflow, [input])
}
