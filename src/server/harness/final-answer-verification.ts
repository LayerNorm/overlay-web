import type { HarnessSnapshot } from '@overlay/agent-runtime/harness-state'
import { harnessCandidateDigest } from './continuity'
import type { HarnessExecutionPorts } from './ports'

export type FinalAnswerVerificationOutcome =
  | { kind: 'verified'; state: HarnessSnapshot }
  | {
    kind: 'continue'
    state: HarnessSnapshot
    attempt: number
    action: 'none' | 'checkpoint' | 'pending' | 'block'
    question?: string
  }

export async function verifyHarnessFinalAnswer(input: {
  state: HarnessSnapshot
  candidate: string
  segment: number
  ports: HarnessExecutionPorts
}): Promise<FinalAnswerVerificationOutcome> {
  const digest = await harnessCandidateDigest(input.candidate)
  const prior = input.state.finalVerification
  const attemptId = `segment:${input.segment}`
  const sameAttempt = prior?.attemptId === attemptId
    && prior.candidateDigest === digest && prior.planRevision === input.state.planRevision
    && prior.evidenceRevision === input.state.progressRevision
  const attempt = sameAttempt ? prior.attempts : (prior?.attempts ?? 0) + 1
  if (attempt > 3) {
    return {
      kind: 'continue',
      state: input.state,
      attempt,
      action: 'block',
      question: 'The final answer remains unsupported after two corrections. Review the persisted observations before continuing.',
    }
  }
  let verification: Awaited<ReturnType<NonNullable<HarnessExecutionPorts['verifyFinalAnswer']>>>
  try {
    verification = await input.ports.verifyFinalAnswer!({ state: input.state, candidate: input.candidate })
  } catch (error) {
    const afterFailure = await input.ports.read()
    if (afterFailure.status !== 'running') {
      return { kind: 'continue', state: afterFailure, attempt, action: 'none' }
    }
    if (afterFailure.modelReservation?.id.startsWith('verification:')) {
      const recorded = await input.ports.apply(`verify-pending-result:${input.segment}:${attempt}`, {
        type: 'record_verification',
        verification: {
          attemptId, candidateDigest: digest, planRevision: input.state.planRevision,
          evidenceRevision: input.state.progressRevision, supported: false,
          reason: 'Final-answer verification is awaiting provider settlement. No answer was accepted.',
          evidenceIds: [], attempts: attempt, createdAt: Date.now(),
        },
      })
      return {
        kind: 'continue',
        state: recorded,
        attempt,
        action: 'pending',
        question: 'Final-answer verification is awaiting provider settlement. No answer was accepted; resume after the hold reconciles.',
      }
    }
    verification = {
      supported: false,
      reason: error instanceof Error ? error.message : 'Final answer verification failed.',
      evidenceIds: [],
    }
  }
  const verified = await input.ports.apply(`verify:${input.segment}:${attempt}`, {
    type: 'record_verification',
    verification: {
      attemptId,
      candidateDigest: digest,
      planRevision: input.state.planRevision,
      evidenceRevision: input.state.progressRevision,
      supported: verification.supported,
      reason: verification.reason.slice(0, 1_000),
      evidenceIds: verification.evidenceIds,
      attempts: attempt,
      createdAt: Date.now(),
    },
  })
  if (verification.supported) return { kind: 'verified', state: verified }
  return {
    kind: 'continue',
    state: verified,
    attempt,
    action: attempt < 3 ? 'checkpoint' : 'block',
    ...(attempt >= 3 ? {
      question: `Final answer could not be supported by persisted observations: ${verification.reason.slice(0, 900)}`,
    } : {}),
  }
}
