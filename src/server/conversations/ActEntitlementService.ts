import 'server-only'

import { modelSupportsZeroDataRetention } from '@/shared/ai/gateway/model-data'
import { isFreeTierChatModelId } from '@/shared/ai/gateway/model-types'
import {
  buildInsufficientCreditsPayload,
  canUsePaidBudgetFeatures,
  ensurePayerBudgetAvailable,
  getBudgetTotals,
  isPaidPlan,
} from '@/server/billing/billing-runtime'
import type { AppSettings, Entitlements } from '@/shared/app/app-contracts'
import type { ActConversationRepository } from './ActConversationRepository'
import type { ActUsagePolicy } from './ActUsagePolicy'

export class ActConversationServiceError extends Error {
  constructor(
    readonly payload: Record<string, unknown>,
    readonly statusCode: number,
    message?: string,
  ) {
    super(message ?? String(payload.error ?? 'Act conversation service error'))
    this.name = 'ActConversationServiceError'
  }
}

function serviceError(payload: Record<string, unknown>, statusCode: number): never {
  throw new ActConversationServiceError(payload, statusCode)
}

export type ActModelGateResult = {
  appSettings: AppSettings | null
  paid: boolean
  runtimeEntitlements: Entitlements
}

export class ActEntitlementService {
  constructor(private readonly deps: {
    usagePolicy?: Pick<ActUsagePolicy, 'getEntitlements'>
    repository: ActConversationRepository
  }) {}

  async gateModelAccess(args: {
    effectiveModelId: string
    userId: string
    workspaceId?: string
    programmaticSubjectId?: string
  }): Promise<ActModelGateResult> {
    const [entitlements, appSettings] = await Promise.all([
      this.getEntitlements(args),
      this.deps.repository.getAppSettings({ userId: args.userId }),
    ])

    if (!entitlements) {
      serviceError(
        { error: 'Unauthorized', message: 'Could not verify subscription. Try signing out and back in.' },
        401,
      )
    }

    let runtimeEntitlements = entitlements
    const budget = getBudgetTotals(runtimeEntitlements)
    const effectiveModelSupportsZdr = modelSupportsZeroDataRetention(args.effectiveModelId)

    if (isPaidPlan(runtimeEntitlements) && budget.remainingCents <= 0) {
      const autoTopUp = await ensurePayerBudgetAvailable({
        userId: args.userId,
        entitlements: runtimeEntitlements,
        minimumRequiredCents: 1,
        programmaticSubjectId: args.programmaticSubjectId,
        workspaceId: args.workspaceId,
      })
      runtimeEntitlements = autoTopUp.entitlements
    }

    let paid = canUsePaidBudgetFeatures(runtimeEntitlements)
    if (!paid) {
      if (!isFreeTierChatModelId(args.effectiveModelId)) {
        if (isPaidPlan(runtimeEntitlements)) {
          serviceError(
            buildInsufficientCreditsPayload(
              runtimeEntitlements,
              'No budget remaining. Switch to a free model or top up your account.',
            ),
            402,
          )
        }
        serviceError(
          {
            error: 'premium_model_not_allowed',
            message: 'Free tier is limited to free models. Upgrade to a paid plan to use premium models.',
          },
          403,
        )
      }
    }
    if (paid && appSettings?.onlyAllowZdrModels && !effectiveModelSupportsZdr) {
      serviceError(
        {
          error: 'zdr_model_required',
          message: 'Your settings only allow zero data retention models. Choose a ZDR-supported model to continue.',
        },
        400,
      )
    }

    const refreshedEntitlements = await this.getEntitlements(args)

    if (!refreshedEntitlements) {
      serviceError(
        { error: 'Unauthorized', message: 'Could not refresh subscription state.' },
        401,
      )
    }

    runtimeEntitlements = refreshedEntitlements
    paid = canUsePaidBudgetFeatures(runtimeEntitlements)

    if (!paid && !isFreeTierChatModelId(args.effectiveModelId)) {
      if (isPaidPlan(runtimeEntitlements)) {
        serviceError(
          buildInsufficientCreditsPayload(
            runtimeEntitlements,
            'No budget remaining. Switch to a free model or top up your account.',
          ),
          402,
        )
      }
      serviceError(
        {
          error: 'premium_model_not_allowed',
          message: 'Free tier is limited to free models. Upgrade to a paid plan to use premium models.',
        },
        403,
      )
    }

    return {
      appSettings,
      paid,
      runtimeEntitlements,
    }
  }

  private async getEntitlements(args: {
    userId: string
    workspaceId?: string
    programmaticSubjectId?: string
  }): Promise<Entitlements | null> {
    return await (this.deps.usagePolicy ?? this.deps.repository).getEntitlements(args)
  }
}
