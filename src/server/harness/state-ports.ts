import type { HarnessExecutionPorts } from './ports'
import type { HarnessExecutionReference } from './state-steps'
import { applyHarnessOperation, claimHarnessState, readHarnessEvidence, readHarnessState } from './state-steps'

export function createHarnessStatePorts(reference: HarnessExecutionReference): Pick<HarnessExecutionPorts, 'claim' | 'read' | 'apply' | 'readEvidence'> {
  return {
    claim: () => claimHarnessState(reference),
    read: () => readHarnessState(reference),
    apply: (operationId, operation) => applyHarnessOperation(reference, operationId, operation),
    readEvidence: evidenceId => readHarnessEvidence(reference, evidenceId),
  }
}
