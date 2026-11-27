import 'server-only'

import { createMonidClient, type MonidClient } from '@/server/integrations/monid/client'
import { getServerProviderKey } from '@/server/ai/gateway/server-provider-keys'
import { billableBudgetCentsFromProviderUsd } from '@/server/billing/billing-runtime'
import { getBudgetTotals } from '@/server/billing/billing-runtime-details'
import { getOverlayServerContext } from '@/server/bootstrap'
import { getOverlayCapabilities } from '@/server/capabilities'
import { configuredUsageMarkupBasisPoints } from '@/server/env/usage-markup'
import { fileService } from '@/server/files/http'
import { createGuardedFetch } from '@/server/security/guarded-fetch'
import type { ToolBillingContext } from './types'

/** What the Data and APIs tools need from the rest of Overlay; tests pass fakes. */
export interface MonidToolDeps {
  client(): Promise<MonidClient | null>
  sideEffectEndpoints(client: MonidClient): Promise<Set<string>>
  billingEnabled(): Promise<boolean>
  markupBasisPoints(): number
  ensureBudgetNotLow(args: {
    billing: ToolBillingContext
    userId: string
    workspaceId?: string
    modelId: string
  }): Promise<{ ok: true; remainingCents: number } | { ok: false }>
  charge(args: {
    billing: ToolBillingContext
    userId: string
    workspaceId?: string
    operationId: string
    providerCostUsd: number
    modelId: string
  }): Promise<{ budgetLow: boolean }>
  /** The workspace price of a provider cost: markup applied, in cents. */
  billableCents(providerCostUsd: number): number
  download(url: string): Promise<{ bytes: Uint8Array; mimeType: string }>
  saveBytes(args: { bytes: Uint8Array; name: string; mimeType: string; userId: string; workspaceId?: string; scope: 'personal' | 'workspace'; byAgent: boolean }): Promise<string>
  saveText(args: { text: string; name: string; mimeType: string; userId: string; workspaceId?: string; scope: 'personal' | 'workspace'; byAgent: boolean }): Promise<string>
  sleep(ms: number, signal?: AbortSignal): Promise<void>
  now(): number
}

const SIDE_EFFECT_CACHE_MS = 10 * 60_000
const MAX_OUTPUT_FILE_BYTES = 100 * 1024 * 1024

let sideEffectCache: { keys: Set<string>; fetchedAt: number } | null = null
let sideEffectLoad: Promise<Set<string>> | null = null

export function defaultMonidToolDeps(): MonidToolDeps {
  return {
    async client() {
      const apiKey = await getServerProviderKey('monid')
      return apiKey ? createMonidClient({ apiKey }) : null
    },
    async sideEffectEndpoints(client) {
      if (sideEffectCache && Date.now() - sideEffectCache.fetchedAt < SIDE_EFFECT_CACHE_MS) return sideEffectCache.keys
      sideEffectLoad ??= client.listSideEffectEndpoints()
        .then((keys) => {
          sideEffectCache = { keys, fetchedAt: Date.now() }
          return keys
        })
        .finally(() => { sideEffectLoad = null })
      return await sideEffectLoad
    },
    async billingEnabled() {
      return (await getOverlayCapabilities()).billing
    },
    markupBasisPoints: configuredUsageMarkupBasisPoints,
    async ensureBudgetNotLow(args) {
      const check = await getOverlayServerContext().generationUsagePolicy.ensureBudgetNotLow({
        entitlements: args.billing.entitlements,
        kind: 'generation',
        modelId: args.modelId,
        operationId: 'monid.run',
        programmaticSubjectId: args.billing.programmaticSubjectId,
        userId: args.userId,
        workspaceId: args.workspaceId,
      })
      if (!check.ok) return { ok: false }
      return { ok: true, remainingCents: getBudgetTotals(check.entitlements).remainingCents }
    },
    async charge(args) {
      return await getOverlayServerContext().generationUsagePolicy.charge({
        operationId: args.operationId,
        programmaticSubjectId: args.billing.programmaticSubjectId,
        providerCostUsd: args.providerCostUsd,
        usage: { kind: 'generation', modelId: args.modelId, inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
        userId: args.userId,
        workspaceId: args.workspaceId,
      })
    },
    billableCents: billableBudgetCentsFromProviderUsd,
    async download(url) {
      const guardedFetch = createGuardedFetch({ maxResponseBytes: MAX_OUTPUT_FILE_BYTES, timeoutMs: 120_000 })
      const response = await guardedFetch(url)
      if (!response.ok) throw new Error(`Downloading the result file failed (HTTP ${response.status}).`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      return { bytes, mimeType: response.headers.get('content-type') ?? 'application/octet-stream' }
    },
    async saveBytes(args) {
      const created = await fileService.createFileFromBytes(args)
      return created.id
    },
    async saveText(args) {
      const created = await fileService.createFile({
        body: { name: args.name, type: 'file', kind: 'upload', textContent: args.text, mimeType: args.mimeType, scope: args.scope, byAgent: args.byAgent },
        userId: args.userId,
        workspaceId: args.workspaceId,
      })
      return String(created.id)
    },
    sleep(ms, signal) {
      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new Error('aborted'))
        const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
        const onAbort = () => { clearTimeout(timer); reject(new Error('aborted')) }
        signal?.addEventListener('abort', onAbort, { once: true })
      })
    },
    now: () => Date.now(),
  }
}
