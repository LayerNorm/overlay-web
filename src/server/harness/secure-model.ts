import type { LanguageModelV4, LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { WORKFLOW_DESERIALIZE, WORKFLOW_SERIALIZE } from '@workflow/serde'
import { wrapLanguageModel } from 'ai'
import { getLanguageModel } from '@/server/ai/model-runtime'
import type { PersonalHarnessModelDispatch } from './personal-model-dispatch'

export type HarnessModelReference = {
  modelId: string
  credentialOwnerId: string
  sessionId?: string
  allowLowBalanceFallback?: boolean
  personal?: PersonalHarnessModelDispatch
}

export class HarnessLanguageModel implements LanguageModelV4 {
  readonly specificationVersion = 'v4' as const
  readonly provider = 'overlay-harness'
  readonly supportedUrls = {}

  constructor(readonly reference: HarnessModelReference) {}

  get modelId() { return this.reference.modelId }

  static [WORKFLOW_SERIALIZE](model: HarnessLanguageModel): HarnessModelReference {
    const personal = model.reference.personal
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
          authentication: personal.access.authentication.type === 'api-key'
            ? { type: 'api-key' as const, apiKeyId: personal.access.authentication.apiKeyId }
            : { type: personal.access.authentication.type },
        },
        receiptId: personal.receiptId, memoryEnabled: personal.memoryEnabled, requestFingerprint: personal.requestFingerprint,
        ...(personal.billingProgrammaticSubjectId ? { billingProgrammaticSubjectId: personal.billingProgrammaticSubjectId } : {}),
        inputTokenBudget: personal.inputTokenBudget, maxOutputTokens: personal.maxOutputTokens, contextWindow: personal.contextWindow,
      } } : {}),
    }
  }

  static [WORKFLOW_DESERIALIZE](reference: HarnessModelReference) {
    return new HarnessLanguageModel(reference)
  }

  async doStream(options: LanguageModelV4CallOptions) {
    'use step'
    if (this.reference.personal) {
      const { authorizePersonalHarnessModelDispatch } = await import('./personal-model-dispatch')
      await authorizePersonalHarnessModelDispatch(this.reference, options)
    }
    const model = await getLanguageModel(this.reference.modelId, undefined, this.reference.credentialOwnerId, {
      sessionId: this.reference.sessionId,
      allowLowBalanceFallback: this.reference.allowLowBalanceFallback,
    })
    try {
      return await wrapLanguageModel({ model, middleware: [] }).doStream(options)
    } catch (error) {
      await recordConfirmedRejection(this.reference, error)
      throw error
    }
  }

  async doGenerate(options: LanguageModelV4CallOptions) {
    'use step'
    if (this.reference.personal) {
      const { authorizePersonalHarnessModelDispatch } = await import('./personal-model-dispatch')
      await authorizePersonalHarnessModelDispatch(this.reference, options)
    }
    const model = await getLanguageModel(this.reference.modelId, undefined, this.reference.credentialOwnerId, {
      sessionId: this.reference.sessionId,
      allowLowBalanceFallback: this.reference.allowLowBalanceFallback,
    })
    try {
      return await wrapLanguageModel({ model, middleware: [] }).doGenerate(options)
    } catch (error) {
      await recordConfirmedRejection(this.reference, error)
      throw error
    }
  }
}

async function recordConfirmedRejection(reference: HarnessModelReference, error: unknown): Promise<void> {
  if (!reference.personal || reference.modelId.startsWith('byok/')) return
  const { isConfirmedHarnessModelRejection, recordHarnessModelRejection } = await import('./model-rejection')
  if (isConfirmedHarnessModelRejection(error)) await recordHarnessModelRejection(reference, 'model_unavailable')
}

Object.assign(HarnessLanguageModel.prototype.doStream, { maxRetries: 0 })
Object.assign(HarnessLanguageModel.prototype.doGenerate, { maxRetries: 0 })
