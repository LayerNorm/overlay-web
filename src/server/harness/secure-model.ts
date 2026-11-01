import type { LanguageModelV4, LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from '@workflow/serde'
import type { PersonalHarnessModelDispatch } from './personal-model-dispatch'
import type { NativeHarnessModelDispatch } from './native-model-dispatch'
import { serializePersonalHarnessAuthentication } from './personal-authentication'

export type HarnessModelReference = {
  modelId: string
  credentialOwnerId: string
  sessionId?: string
  allowLowBalanceFallback?: boolean
  personal?: PersonalHarnessModelDispatch
  native?: NativeHarnessModelDispatch
}

function assertSingleAuthority(reference: HarnessModelReference): void {
  if (reference.personal && reference.native) throw new Error('A model dispatch cannot have both personal and native authority.')
}

export class HarnessLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = 'v4' as const
  readonly provider = 'overlay-harness'
  readonly supportedUrls = {}

  constructor(readonly reference: HarnessModelReference) {}

  get modelId() { return this.reference.modelId }

  static [WORKFLOW_SERIALIZE](model: HarnessLanguageModel): HarnessModelReference {
    const personal = model.reference.personal
    const native = model.reference.native
    assertSingleAuthority(model.reference)
    return {
      modelId: model.reference.modelId,
      credentialOwnerId: model.reference.credentialOwnerId,
      ...(model.reference.sessionId ? { sessionId: model.reference.sessionId } : {}),
      ...(model.reference.allowLowBalanceFallback !== undefined ? { allowLowBalanceFallback: model.reference.allowLowBalanceFallback } : {}),
      ...(personal ? { personal: {
        access: {
          actorUserId: personal.access.actorUserId, runId: personal.access.runId, workflowRunId: personal.access.workflowRunId,
          conversationId: personal.access.conversationId, agentRunId: personal.access.agentRunId,
          workspaceId: personal.access.workspaceId, principalId: personal.access.principalId,
          authentication: serializePersonalHarnessAuthentication(personal.access.authentication),
        },
        receiptId: personal.receiptId, memoryEnabled: personal.memoryEnabled, requestFingerprint: personal.requestFingerprint,
        ...(personal.access.authentication.type === 'automation' && personal.automationContext ? { automationContext: {
          turnId: personal.automationContext.turnId,
          accountAllowedToolIds: [...personal.automationContext.accountAllowedToolIds],
          accountAllowedConnectorIds: [...personal.automationContext.accountAllowedConnectorIds],
          integrationToolIds: [...personal.automationContext.integrationToolIds],
        } } : {}),
        ...(personal.billingProgrammaticSubjectId ? { billingProgrammaticSubjectId: personal.billingProgrammaticSubjectId } : {}),
        inputTokenBudget: personal.inputTokenBudget, maxOutputTokens: personal.maxOutputTokens, contextWindow: personal.contextWindow,
      } } : {}),
      ...(native ? { native: {
        access: {
          actorUserId: native.access.actorUserId, runId: native.access.runId, workflowRunId: native.access.workflowRunId,
          workspaceId: native.access.workspaceId, principalId: native.access.principalId,
          agentId: native.access.agentId, agentPrincipalId: native.access.agentPrincipalId,
          conversationId: native.access.conversationId, agentRunId: native.access.agentRunId,
          userMessageId: native.access.userMessageId, assistantMessageId: native.access.assistantMessageId, turnId: native.access.turnId,
        },
        receiptId: native.receiptId, memoryEnabled: native.memoryEnabled, sharedRoom: native.sharedRoom,
        ...(native.streamToDelivery === true ? { streamToDelivery: true } : {}),
        requestFingerprint: native.requestFingerprint, inputTokenBudget: native.inputTokenBudget,
        maxOutputTokens: native.maxOutputTokens, contextWindow: native.contextWindow,
      } } : {}),
    }
  }

  static [WORKFLOW_DESERIALIZE](reference: HarnessModelReference) {
    return new HarnessLanguageModel(reference)
  }

  async doStream(options: LanguageModelV4CallOptions) {
    return streamHarnessModel(this.reference, options)
  }

  async doGenerate(options: LanguageModelV4CallOptions) {
    return generateHarnessModel(this.reference, options)
  }
}

export async function streamHarnessModel(reference: HarnessModelReference, options: LanguageModelV4CallOptions) {
  'use step'
  assertSingleAuthority(reference)
  if (reference.personal) {
    const { authorizePersonalHarnessModelDispatch } = await import('./personal-model-dispatch')
    await authorizePersonalHarnessModelDispatch(reference, options)
  }
  if (reference.native) {
    const { authorizeNativeHarnessModelDispatch } = await import('./native-model-dispatch')
    await authorizeNativeHarnessModelDispatch(reference, options)
  }
  const { secureModelDoStream } = await import('./secure-model-runtime')
  return secureModelDoStream(reference, options)
}

export async function generateHarnessModel(reference: HarnessModelReference, options: LanguageModelV4CallOptions) {
  'use step'
  assertSingleAuthority(reference)
  if (reference.personal) {
    const { authorizePersonalHarnessModelDispatch } = await import('./personal-model-dispatch')
    await authorizePersonalHarnessModelDispatch(reference, options)
  }
  if (reference.native) {
    const { authorizeNativeHarnessModelDispatch } = await import('./native-model-dispatch')
    await authorizeNativeHarnessModelDispatch(reference, options)
  }
  const { secureModelDoGenerate } = await import('./secure-model-runtime')
  return secureModelDoGenerate(reference, options)
}

streamHarnessModel.maxRetries = 0
generateHarnessModel.maxRetries = 0
