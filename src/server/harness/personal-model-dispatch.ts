import 'server-only'

import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { FatalError } from 'workflow'
import { refreshPersonalHarnessAccess, type PersonalHarnessAccess } from './personal-access'
import { authorizeHarnessModelDispatch, type HarnessModelDispatch } from './model-dispatch'
import type { HarnessModelReference } from './secure-model'
import { surfaceHarnessTurnId } from './surface-authority'

export type PersonalHarnessModelDispatch = Omit<HarnessModelDispatch, 'access'> & {
  access: PersonalHarnessAccess
  memoryEnabled: boolean
  automationContext?: {
    turnId: string
    accountAllowedToolIds: string[]
    accountAllowedConnectorIds: string[]
    integrationToolIds: string[]
  }
  surfaceContext?: {
    turnId: string
    accountAllowedToolIds: string[]
    accountAllowedConnectorIds: string[]
    integrationToolIds: string[]
  }
}

export async function authorizePersonalHarnessModelDispatch(reference: HarnessModelReference, options: LanguageModelV4CallOptions): Promise<void> {
  const input = reference.personal
  if (!input) throw new FatalError('Personal model dispatch identity or routing is invalid.')
  if (input.access.authentication.type === 'automation' && !input.automationContext?.turnId) {
    throw new FatalError('Automation model dispatch context is missing.')
  }
  if (input.access.authentication.type === 'surface'
    && (!input.surfaceContext || input.surfaceContext.turnId !== surfaceHarnessTurnId(input.access.authentication)
      || input.billingProgrammaticSubjectId !== `surface:slack:${input.access.authentication.bindingId}`)) {
    throw new FatalError('Surface model dispatch context is missing or invalid.')
  }
  const surfaceContext = input.access.authentication.type === 'surface' ? input.surfaceContext : undefined
  const automationContext = input.access.authentication.type === 'automation' ? input.automationContext : undefined
  const turnId = automationContext?.turnId ?? surfaceContext?.turnId ?? input.receiptId
  const billingProgrammaticSubjectId = input.access.authentication.type === 'automation'
    ? `automation:${input.access.authentication.automationId}`
    : input.access.authentication.type === 'surface'
      ? `surface:slack:${input.access.authentication.bindingId}`
      : input.billingProgrammaticSubjectId
  await authorizeHarnessModelDispatch(reference, options, input, () => refreshPersonalHarnessAccess(input.access, {
    baseUrl: '', userId: input.access.actorUserId, workspaceId: input.access.workspaceId,
    conversationId: input.access.conversationId, effectiveModelId: reference.modelId,
    turnId, requestFingerprint: input.requestFingerprint, memoryEnabled: input.memoryEnabled,
    billingProgrammaticSubjectId,
    requestedToolIds: [], approvalMode: input.access.authentication.type === 'automation' ? 'ask' : undefined,
    ...(automationContext && input.access.authentication.type === 'automation'
      ? { ...automationContext, automationExecution: true, automationId: input.access.authentication.automationId,
        automationRunId: input.access.authentication.automationRunId } : {}),
    ...(surfaceContext ? { ...surfaceContext, automationExecution: true } : {}),
  }))
}
