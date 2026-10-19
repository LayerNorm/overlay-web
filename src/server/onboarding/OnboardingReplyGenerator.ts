import 'server-only'

import { generateText, Output } from 'ai'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getBillingProgrammaticSubjectId } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getOrCreateGateway } from '@/server/ai/gateway/gateway-runtime'
import { isHostedProviderAccessDisabled } from '@/server/ai/gateway/hosted-provider-kill-switch'
import { resolveAuthorizedModelIds } from '@/server/ai/model-policy-authority'
import { preparedOnboardingReply } from '@/shared/onboarding/session'
import type { OnboardingReplyFactory } from './ConversationalOnboardingService'
import { cleanOnboardingReply, hasVerifiedFreePricing, ONBOARDING_MODEL, onboardingPrompt } from './onboarding-personalization'

export function createOnboardingReplyGenerator(context: AppApiRouteContext): OnboardingReplyFactory {
  return async (step, profile, enabled) => {
    const fallback = preparedOnboardingReply(step, profile)
    const prompt = onboardingPrompt(step, profile)
    if (!enabled || !prompt || isHostedProviderAccessDisabled() || !context.capabilities.chat) return fallback
    try {
      const signal = AbortSignal.timeout(12_000)
      const response = await fetch('https://ai-gateway.vercel.sh/v1/models', { cache: 'no-store', signal })
      if (!response.ok) return fallback
      const catalog = await response.json() as { data?: unknown[] }
      if (!Array.isArray(catalog.data) || !catalog.data.some(hasVerifiedFreePricing)) return fallback
      const server = getOverlayServerContext()
      const policy = server.generationUsagePolicy
      const subject = { userId: context.auth.userId, workspaceId: context.workspace.workspace.id, programmaticSubjectId: getBillingProgrammaticSubjectId(context) }
      const entitlements = await policy.getEntitlements(subject)
      if (!entitlements) return fallback
      const allowed = await resolveAuthorizedModelIds({ entitlements, verifiedFreeOnboardingModel: ONBOARDING_MODEL })
      if (!allowed.chat.has(ONBOARDING_MODEL)) return fallback
      const gateway = await getOrCreateGateway()
      const operationId = `onboarding.reply:${context.requestFingerprint}`
      const reservation = await policy.reserve({ ...subject, entitlements, providerCostUsd: 0, kind: 'generation', modelId: ONBOARDING_MODEL, operationId: 'onboarding.reply', requestFingerprint: context.requestFingerprint, idempotencyKey: operationId })
      if (!reservation.ok) return fallback
      let started = false
      try {
        await policy.markStarted({ userId: subject.userId, reservationId: reservation.reservationId })
        started = true
        const result = await generateText({
          model: gateway(ONBOARDING_MODEL), system: prompt.system, prompt: prompt.prompt,
          output: Output.object({ schema: prompt.schema }), maxOutputTokens: 1800, maxRetries: 0,
          abortSignal: signal, providerOptions: { gateway: { models: [] } }, telemetry: { isEnabled: false },
        })
        const inputTokens = result.usage.inputTokens ?? 0
        const outputTokens = result.usage.outputTokens ?? 0
        if (reservation.reservationId) {
          await policy.finalize({ userId: subject.userId, reservationId: reservation.reservationId, actualProviderCostUsd: 0, events: [{ type: 'generation', modelId: ONBOARDING_MODEL, inputTokens, outputTokens, cachedTokens: 0, cost: 0, timestamp: Date.now() }] })
        } else {
          await server.appData.repositories.usage.recordBatch({ userId: subject.userId, operationId, events: [{ kind: 'generation', modelId: ONBOARDING_MODEL, inputTokens, outputTokens, cachedTokens: 0, costCents: 0, providerCostUsd: 0, occurredAt: Date.now() }] })
        }
        if (result.finishReason !== 'stop' || !result.response.modelId.toLowerCase().includes('minimax-m3.1-flash')) return fallback
        return cleanOnboardingReply(result.output, step)
      } catch (_error) {
        await policy.release({ userId: subject.userId, reservationId: reservation.reservationId, providerWorkStarted: started, reason: 'onboarding_personalization_unavailable' }).catch((_releaseError) => undefined)
        return fallback
      }
    } catch (_error) { return fallback }
  }
}
