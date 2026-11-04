import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'

export const HARNESS_PLAN_REPAIR_LIMIT = 4
export type HarnessPlanRepairState = { attempts: number; evidence: string }

export function planRepairEvidence(state: HarnessSnapshot): string {
  return JSON.stringify(state.evidence.filter(item => item.kind === 'tool_result' && item.verdict !== 'failed')
    .map(item => [item.id, item.verdict]).sort((left, right) => left[0].localeCompare(right[0])))
}

export function advancePlanRepair(
  previous: HarnessPlanRepairState,
  state: HarnessSnapshot,
  toolNames: string[],
  hadPlan: boolean,
  failedUpdateStep = false,
): HarnessPlanRepairState {
  const evidence = planRepairEvidence(state)
  if (evidence !== previous.evidence) return { attempts: 0, evidence }
  const initialPlan = !hadPlan && state.plan.length > 0 && toolNames.includes('harness_set_plan')
  const planning = !initialPlan && (toolNames.some(name => ['harness_set_plan', 'harness_revise_step'].includes(name))
    || failedUpdateStep && toolNames.includes('harness_update_step'))
  return { attempts: previous.attempts + (planning ? 1 : 0), evidence }
}

export const HARNESS_PLAN_REPAIR_PAUSE = 'I could not finish organizing the remaining work after several attempts. Completed tool results are saved, but the task is not complete. Review the saved work before continuing.'
