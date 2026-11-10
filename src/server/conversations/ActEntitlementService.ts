import 'server-only'

import { modelSupportsZeroDataRetention } from '@/shared/ai/gateway/model-data'
import { isRetiredHostedModelId } from '@/shared/ai/gateway/model-types'
import {
  ensurePayerBudgetAvailable,
  getBudgetTotals,
} from '@/server/billing/billing-runtime'
import {
  requireWorkspaceExecution,
  WorkspaceExecutionError,
} from '@/server/billing/WorkspaceExecutionPolicy'
import type { AppSettings, Entitlements } from '@/shared/app/app-contracts'
import { workspaceBudgetLow, workspaceBudgetStopLineCents } from '@/shared/billing/execution-access'
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
    requireExecution?: typeof requireWorkspaceExecution
    repository: ActConversationRepository
  }) {}

  async gateModelPolicy(args: {
    effectiveModelId: string
    userId: string
    workspaceId?: string
    programmaticSubjectId?: string
  }): Promise<ActModelGateResult> {
    const { appSettings, entitlements } = await this.authorizeModel(args)
    return { appSettings, paid: true, runtimeEntitlements: entitlements }
  }

  async gateModelAccess(args: {
    effectiveModelId: string
    userId: string
    workspaceId?: string
    programmaticSubjectId?: string
  }): Promise<ActModelGateResult> {
    const { appSettings, billingEnabled, entitlements } = await this.authorizeModel(args)
    let runtimeEntitlements = entitlements

    const totals = getBudgetTotals(runtimeEntitlements)
    if (billingEnabled && workspaceBudgetLow({ remainingCents: totals.remainingCents, totalCents: totals.totalCents })) {
      const autoTopUp = await ensurePayerBudgetAvailable({
        userId: args.userId,
        entitlements: runtimeEntitlements,
        minimumRequiredCents: workspaceBudgetStopLineCents(totals),
        programmaticSubjectId: args.programmaticSubjectId,
        workspaceId: args.workspaceId,
      })
      runtimeEntitlements = autoTopUp.entitlements
    }

    await this.requireExecution({
      userId: args.userId,
      workspaceId: args.workspaceId,
      checkBudget: true,
    })

    const refreshedEntitlements = await this.getEntitlements(args)

    if (!refreshedEntitlements) {
      serviceError(
        { error: 'Unauthorized', message: 'Could not refresh subscription state.' },
        401,
      )
    }

    return {
      appSettings,
      paid: true,
      runtimeEntitlements: refreshedEntitlements,
    }
  }

  private async authorizeModel(args: {
    effectiveModelId: string
    userId: string
    workspaceId?: string
    programmaticSubjectId?: string
  }): Promise<{ appSettings: AppSettings | null; billingEnabled: boolean; entitlements: Entitlements }> {
    if (isRetiredHostedModelId(args.effectiveModelId)) {
      serviceError({
        error: 'model_retired',
        message: 'This model is retired. Choose a supported paid model to continue.',
      }, 400)
    }
    const execution = await this.requireExecution({
      userId: args.userId,
      workspaceId: args.workspaceId,
      checkBudget: false,
    })
    const [entitlements, appSettings] = await Promise.all([
      this.getEntitlements(args),
      this.deps.repository.getAppSettings({ userId: args.userId }),
    ])
    if (!entitlements) {
      serviceError({ error: 'Unauthorized', message: 'Could not verify subscription. Try signing out and back in.' }, 401)
    }
    if (appSettings?.onlyAllowZdrModels && !modelSupportsZeroDataRetention(args.effectiveModelId)) {
      serviceError({
        error: 'zdr_model_required',
        message: 'Your settings only allow zero data retention models. Choose a ZDR-supported model to continue.',
      }, 400)
    }
    return { appSettings, billingEnabled: execution.billingEnabled, entitlements }
  }

  private async requireExecution(args: {
    userId: string
    workspaceId?: string
    checkBudget: boolean
  }) {
    try {
      return await (this.deps.requireExecution ?? requireWorkspaceExecution)(args)
    } catch (error) {
      if (error instanceof WorkspaceExecutionError) {
        serviceError(error.payload, error.statusCode)
      }
      throw error
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
