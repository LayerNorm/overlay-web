export const HARNESS_STEP_VALIDATION = {
  dependencies: 'Dependencies are not complete.',
  // A deployed backend can still return these until it catches up with web.
  evidenceReference: 'Evidence must reference successful observations from this run.',
  evidenceRequired: 'Completion requires evidence.',
  toolEvidenceRequired: 'Completion requires tool-result evidence.',
  matchingToolEvidenceRequired: "Completion requires tool-result evidence from this milestone's evidenceTools.",
  reusedToolEvidence: 'Evidence from a tool result already supports another milestone.',
  verification: 'Independent verification of this milestone in the current plan revision is required.',
} as const

export function isHarnessStepValidation(message: string): boolean {
  return Object.values(HARNESS_STEP_VALIDATION).some(value => value === message)
}
