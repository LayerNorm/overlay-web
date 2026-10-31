import 'server-only'

import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { FatalError } from 'workflow'
import { refreshPersonalHarnessAccess, type PersonalHarnessAccess } from './personal-access'
import { authorizeHarnessModelDispatch, type HarnessModelDispatch } from './model-dispatch'
import type { HarnessModelReference } from './secure-model'

export type PersonalHarnessModelDispatch = Omit<HarnessModelDispatch, 'access'> & {
  access: PersonalHarnessAccess
  memoryEnabled: boolean
}

export async function authorizePersonalHarnessModelDispatch(reference: HarnessModelReference, options: LanguageModelV4CallOptions): Promise<void> {
  const input = reference.personal
  if (!input) throw new FatalError('Personal model dispatch identity or routing is invalid.')
  await authorizeHarnessModelDispatch(reference, options, input, () => refreshPersonalHarnessAccess(input.access, {
    baseUrl: '', userId: input.access.actorUserId, workspaceId: input.access.workspaceId,
    conversationId: input.access.conversationId, effectiveModelId: reference.modelId,
    turnId: input.receiptId, requestFingerprint: input.requestFingerprint, memoryEnabled: input.memoryEnabled,
    billingProgrammaticSubjectId: input.billingProgrammaticSubjectId
      ?? (input.access.authentication.type === 'automation'
        ? `automation:${input.access.authentication.automationId}` : undefined),
    requestedToolIds: [], approvalMode: input.access.authentication.type === 'automation' ? 'ask' : undefined,
    ...(input.access.authentication.type === 'automation'
      ? { automationExecution: true, automationId: input.access.authentication.automationId } : {}),
  }))
}
