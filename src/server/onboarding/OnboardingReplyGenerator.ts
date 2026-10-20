import 'server-only'

import { generateText, Output } from 'ai'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { getBillingProgrammaticSubjectId } from '@/server/app-api/bff-context'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getGatewayLanguageModel } from '@/server/ai/gateway/ai-gateway'
import { isHostedProviderAccessDisabled } from '@/server/ai/gateway/hosted-provider-kill-switch'
import { resolveAuthorizedModelIds } from '@/server/ai/model-policy-authority'
import { preparedOnboardingReply } from '@/shared/onboarding/session'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import type { AppSettings } from '@/shared/app/app-contracts'
import type { OnboardingReplyFactory } from './ConversationalOnboardingService'
import { cleanOnboardingReply, ONBOARDING_MODEL, onboardingPrompt } from './onboarding-personalization'

const defaultDependencies = {
  server: getOverlayServerContext,
  model: getGatewayLanguageModel,
  authorize: resolveAuthorizedModelIds,
  disabled: isHostedProviderAccessDisabled,
  settings: (userId: string) => convex.query<AppSettings>('platform/uiSettings:getByServer', {
    userId, serverSecret: getInternalApiSecret(),
  }, { throwOnError: true }),
}

export function createOnboardingReplyGenerator(context: AppApiRouteContext, dependencies: Partial<typeof defaultDependencies> = {}): OnboardingReplyFactory {
  const deps = { ...defaultDependencies, ...dependencies }
  return async (step, profile, enabled) => {
    const fallback = preparedOnboardingReply(step, profile)
    const prompt = onboardingPrompt(step, profile)
    if (!enabled || !prompt || deps.disabled() || !context.capabilities.chat) return fallback
    try {
      const signal = AbortSignal.timeout(12_000)
      const settings = await deps.settings(context.auth.userId)
      if (!settings || settings.onlyAllowZdrModels) return fallback
      const server = deps.server()
      const policy = server.generationUsagePolicy
      const subject = { userId: context.auth.userId, workspaceId: context.workspace.workspace.id, programmaticSubjectId: getBillingProgrammaticSubjectId(context) }
      const entitlements = await policy.getEntitlements(subject)
      if (!entitlements) return fallback
      const allowed = await deps.authorize({ entitlements })
      if (!allowed.chat.has(ONBOARDING_MODEL)) return fallback
      const model = await deps.model(ONBOARDING_MODEL)
      const operationId = `onboarding.reply:${context.requestFingerprint}`
      const reservation = await policy.reserve({ ...subject, entitlements, providerCostUsd: 0, kind: 'generation', modelId: ONBOARDING_MODEL, operationId: 'onboarding.reply', requestFingerprint: context.requestFingerprint, idempotencyKey: operationId })
      if (!reservation.ok) return fallback
      let started = false
      try {
        await policy.markStarted({ userId: subject.userId, reservationId: reservation.reservationId })
        started = true
        const result = await generateText({
          model, system: prompt.system, prompt: prompt.prompt,
          output: Output.object({ schema: prompt.schema }), maxOutputTokens: 1800, maxRetries: 0,
          abortSignal: signal, telemetry: { isEnabled: false },
        })
        const receipt = result.providerMetadata?.overlayFree
        if (receipt?.safe !== true || receipt.cost !== 0) throw new Error('Unsafe onboarding routing receipt')
        const inputTokens = result.usage.inputTokens ?? 0
        const outputTokens = result.usage.outputTokens ?? 0
        if (reservation.reservationId) {
          await policy.finalize({ userId: subject.userId, reservationId: reservation.reservationId, actualProviderCostUsd: 0, events: [{ type: 'generation', modelId: ONBOARDING_MODEL, inputTokens, outputTokens, cachedTokens: 0, cost: 0, timestamp: Date.now() }] })
        } else {
          await server.appData.repositories.usage.recordBatch({ userId: subject.userId, operationId, events: [{ kind: 'generation', modelId: ONBOARDING_MODEL, inputTokens, outputTokens, cachedTokens: 0, costCents: 0, providerCostUsd: 0, occurredAt: Date.now() }] })
        }
        if (result.finishReason !== 'stop') return fallback
        return cleanOnboardingReply(result.output, step)
      } catch (_error) {
        await policy.release({ userId: subject.userId, reservationId: reservation.reservationId, providerWorkStarted: started, reason: 'onboarding_personalization_unavailable' }).catch((_releaseError) => undefined)
        return fallback
      }
    } catch (_error) { return fallback }
  }
}
