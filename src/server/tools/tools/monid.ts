import 'server-only'

import {
  MONID_TERMINAL_STATUSES,
  MonidApiError,
  monidEndpointKey,
  runCostUsd,
  type MonidClient,
  type MonidEndpointCard,
  type MonidInspectResult,
  type MonidPrice,
  type MonidRun,
  type MonidRunInput,
} from '@/server/integrations/monid/client'
import { logger } from '@/server/observability/logger'
import { defaultMonidToolDeps, type MonidToolDeps } from './monid-deps'
import {
  MAX_INLINE_OUTPUT_CHARS,
  artifactFileName,
  describePrice,
  fileLinksIn,
  stringValuesIn,
  fileUrl,
  previewOutput,
  replaceArtifacts,
  withExtension,
  type SavedApiFile,
} from './monid-output'
import type { OverlayToolsOptions, ToolBillingContext } from './types'

/**
 * Data and APIs tools (internal/develop/monid.md): find, inspect and run paid third-party endpoints through Monid.
 * Read-only endpoints only. Each run is checked against the workspace budget before it starts and charged at
 * Monid's reported cost plus Overlay's usage markup after it ends (workspace budget only, no reservation).
 */

export const MONID_TOOL_IDS = ['search_apis', 'inspect_api', 'run_api', 'save_api_file'] as const

/** How long run_api waits for an asynchronous run before stopping it. */
const RUN_WAIT_MS = 10 * 60_000
const POLL_START_MS = 2_000
const POLL_MAX_MS = 10_000
const MAX_SCHEMA_CHARS = 30_000
const MAX_OUTPUT_FILES = 10

type Failure = { success: false; error: string; message: string }


type ToolContext = Pick<OverlayToolsOptions, 'userId' | 'workspaceId' | 'agentId' | 'sharedRoom' | 'billing'>

// ── search_apis ──────────────────────────────────────────────────────────────

export async function executeSearchApis(
  context: ToolContext,
  input: { query: string; category?: string; limit?: number },
  deps: MonidToolDeps = defaultMonidToolDeps(),
) {
  const client = await deps.client()
  if (!client) return unavailable()
  try {
    const { items, total } = await client.discover({ query: input.query, limit: input.limit ?? 8, category: input.category })
    return {
      success: true as const,
      total,
      results: items.map(summarizeCard),
      next: items.length
        ? 'Call inspect_api on the best match for its input schema and notes, then run_api. Prices are what the workspace pays before Overlay\'s usage fee.'
        : 'Nothing matched. Try plainer words for the data or result you need.',
    }
  } catch (error) {
    return monidFailure(error, 'search_apis')
  }
}

function summarizeCard(card: MonidEndpointCard) {
  return compact({
    provider: card.provider,
    endpoint: card.endpoint,
    name: card.displayName,
    providerName: card.providerDisplayName,
    description: card.displayDescription,
    price: describePrice(card.price),
    health: card.metrics?.status,
    typicalSeconds: typicalSeconds(card.metrics?.runTimeMs?.p50),
    tags: card.tags?.length ? card.tags : undefined,
  })
}

// ── inspect_api ──────────────────────────────────────────────────────────────

export async function executeInspectApi(
  context: ToolContext,
  input: { provider: string; endpoint: string },
  deps: MonidToolDeps = defaultMonidToolDeps(),
) {
  const client = await deps.client()
  if (!client) return unavailable()
  try {
    const [detail, sideEffects] = await Promise.all([
      client.inspect(input),
      deps.sideEffectEndpoints(client).catch((_error) => null),
    ])
    const runnable = sideEffects !== null && !sideEffects.has(monidEndpointKey(detail.provider, detail.endpoint))
    return {
      success: true as const,
      ...summarizeInspect(detail),
      canRun: runnable,
      ...(runnable ? {} : {
        whyNot: sideEffects === null
          ? 'Overlay could not confirm that this endpoint is read-only right now. Try again shortly.'
          : 'This endpoint changes things outside its own answer (accounts, phone numbers, messages, bookings or stored resources), which Overlay does not run. Find a read-only alternative with search_apis.',
      }),
    }
  } catch (error) {
    return monidFailure(error, 'inspect_api')
  }
}

function summarizeInspect(detail: MonidInspectResult) {
  const input = detail.input ?? {}
  const schema = compact({ bodyType: input.bodyType, body: input.body, queryParams: input.queryParams, pathParams: input.pathParams })
  const schemaText = JSON.stringify(schema)
  return compact({
    provider: detail.provider,
    endpoint: detail.endpoint,
    name: detail.displayName,
    providerName: detail.providerName ?? detail.providerDisplayName,
    description: detail.summary || detail.description || detail.displayDescription,
    method: detail.method,
    input: schemaText.length > MAX_SCHEMA_CHARS
      ? { truncated: true, schema: schemaText.slice(0, MAX_SCHEMA_CHARS) }
      : schema,
    inputHelp: 'Pass run_api input as { body, queryParams, pathParams }, each matching the JSON Schema above for that location.',
    price: describePrice(detail.price),
    priceDetail: detail.price,
    notes: detail.notes?.length ? detail.notes : undefined,
    docUrl: detail.docUrl,
    health: detail.metrics?.status,
    typicalSeconds: typicalSeconds(detail.metrics?.runTimeMs?.p50),
    alternatives: detail.alternatives?.length
      ? detail.alternatives.map((alternative) => compact({
          endpoint: alternative.endpoint,
          label: alternative.label,
          price: describePrice(alternative.price),
          limits: alternative.limits,
        }))
      : undefined,
  })
}

// ── run_api ──────────────────────────────────────────────────────────────────

export async function executeRunApi(
  context: ToolContext,
  input: { provider: string; endpoint: string; input?: MonidRunInput },
  call: { toolCallId?: string; abortSignal?: AbortSignal },
  deps: MonidToolDeps = defaultMonidToolDeps(),
) {
  const client = await deps.client()
  if (!client) return unavailable()
  const billing = context.billing
  if (!billing) {
    return failure('billing_unavailable', 'This conversation cannot be billed for paid APIs, so run_api is unavailable here.')
  }
  const key = monidEndpointKey(input.provider, input.endpoint)
  const modelId = `monid/${key}`.slice(0, 200)

  let sideEffects: Set<string>
  try {
    sideEffects = await deps.sideEffectEndpoints(client)
  } catch (error) {
    logger.error('[monid] could not load the side-effect catalog', { error: errorMessage(error) })
    return failure('service_unavailable', 'Overlay could not confirm that this endpoint is read-only right now, so it did not run it. Try again shortly.')
  }
  if (sideEffects.has(key)) {
    return failure('not_read_only', `${key} changes things outside its own answer (accounts, phone numbers, messages, bookings or stored resources). Overlay only runs read-only endpoints; find an alternative with search_apis.`)
  }

  const budget = await deps.ensureBudgetNotLow({ billing, userId: context.userId, workspaceId: context.workspaceId, modelId })
  if (!budget.ok) {
    return failure('insufficient_budget', 'Paid APIs need a paid plan with workspace budget left. Tell the user to add budget or turn on auto top-up in Settings → Billing.')
  }
  const maxCost = await maxCostUsd(budget.remainingCents, deps)
  if (maxCost !== undefined && maxCost <= 0) {
    return failure('insufficient_budget', 'The workspace has no budget left for this run. Tell the user to add budget in Settings → Billing.')
  }

  const idempotencyKey = `overlay-${call.toolCallId ?? globalThis.crypto.randomUUID()}`.slice(0, 255)
  let run: MonidRun
  try {
    run = await startRun(client, {
      provider: input.provider,
      endpoint: input.endpoint,
      input: input.input,
      maxCost,
      tag: runTag(context),
      idempotencyKey,
    }, deps)
  } catch (error) {
    if (error instanceof MonidApiError && error.run) {
      return await settle(context, billing, error.run, modelId, deps)
    }
    if (error instanceof MonidApiError && error.code === 'MAX_COST_EXCEEDED') {
      return failure('insufficient_budget', `This run could cost more than the workspace has left (about $${(maxCost ?? 0).toFixed(2)} before fees). Ask for fewer results, pick a cheaper endpoint, or tell the user to add budget.`)
    }
    return monidFailure(error, 'run_api')
  }

  const deadline = deps.now() + RUN_WAIT_MS
  let interval = POLL_START_MS
  try {
    while (!MONID_TERMINAL_STATUSES.has(run.status)) {
      if (call.abortSignal?.aborted || deps.now() >= deadline) {
        run = await stopRun(client, run)
        if (!MONID_TERMINAL_STATUSES.has(run.status)) {
          return failure('timed_out', `The run ${run.runId} did not finish in time and is stopping. A stopped run is not charged.`)
        }
        break
      }
      await deps.sleep(interval, call.abortSignal)
      interval = Math.min(POLL_MAX_MS, Math.round(interval * 1.5))
      run = await client.getRun(run.runId)
    }
  } catch (error) {
    if (call.abortSignal?.aborted) {
      run = await stopRun(client, run).catch((_error) => run)
      if (!MONID_TERMINAL_STATUSES.has(run.status)) return failure('cancelled', 'The run was cancelled.')
    } else {
      return monidFailure(error, 'run_api')
    }
  }
  return await settle(context, billing, run, modelId, deps)
}

// ── save_api_file ────────────────────────────────────────────────────────────

/**
 * Saves a file a run linked to (for example Meshy's `model_urls.glb`) into Files. Only a run started for this workspace,
 * and only a link that appears in that run's output: Overlay's Monid account is shared, so a run id alone proves nothing.
 */
export async function executeSaveApiFile(
  context: ToolContext,
  input: { runId: string; url: string; name?: string },
  deps: MonidToolDeps = defaultMonidToolDeps(),
) {
  const client = await deps.client()
  if (!client) return unavailable()
  let run: MonidRun
  try {
    run = await client.getRun(input.runId)
  } catch (error) {
    return monidFailure(error, 'save_api_file')
  }
  if (run.tag !== runTag(context)) return failure('not_found', 'No such run in this workspace.')
  if (!/^https:\/\//i.test(input.url) || !stringValuesIn(run.output).has(input.url)) {
    return failure('not_in_output', 'That link is not in the run\'s output. Pass a URL exactly as run_api returned it.')
  }
  try {
    const downloaded = await deps.download(input.url)
    const mimeType = (downloaded.mimeType || 'application/octet-stream').split(';')[0]!.trim()
    const fallback = `${run.provider}${run.endpoint}`.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'api-file'
    const derived = artifactFileName(input.url, mimeType, fallback)
    const name = input.name?.trim() ? withExtension(input.name.trim(), derived) : derived
    const fileId = await deps.saveBytes({
      userId: context.userId,
      workspaceId: context.workspaceId,
      scope: context.sharedRoom ? 'workspace' : 'personal',
      byAgent: Boolean(context.agentId),
      bytes: downloaded.bytes,
      name,
      mimeType,
    })
    return { success: true as const, fileId, url: fileUrl(fileId), name, mimeType, sizeBytes: downloaded.bytes.byteLength }
  } catch (error) {
    return failure('save_failed', `The file could not be saved: ${errorMessage(error)}`)
  }
}

function runTag(context: ToolContext): string {
  return (context.workspaceId ?? context.userId).slice(0, 128)
}

async function startRun(
  client: MonidClient,
  args: Parameters<MonidClient['run']>[0],
  deps: MonidToolDeps,
): Promise<MonidRun> {
  try {
    return await client.run(args)
  } catch (error) {
    // The first request with this key is still starting: asking again returns that run instead of a second one.
    if (error instanceof MonidApiError && error.code === 'IDEMPOTENCY_KEY_IN_USE') {
      await deps.sleep(2_000)
      return await client.run(args)
    }
    throw error
  }
}

async function stopRun(client: MonidClient, run: MonidRun): Promise<MonidRun> {
  try {
    await client.stopRun(run.runId)
  } catch (error) {
    logger.warn('[monid] stop request failed', { runId: run.runId, error: errorMessage(error) })
  }
  return await client.getRun(run.runId).catch((_error) => run)
}

/** Charges what Monid reports for a finished run, then shapes its result for the model. */
async function settle(
  context: ToolContext,
  billing: ToolBillingContext,
  run: MonidRun,
  modelId: string,
  deps: MonidToolDeps,
) {
  const costUsd = runCostUsd(run)
  let chargedUsd = 0
  if (costUsd === null && run.status === 'COMPLETED') {
    // A finished run must say what it cost; charging nothing would be silent under-billing.
    logger.error('[monid] completed run reports no cost', { runId: run.runId, modelId })
  }
  if (costUsd !== null && costUsd > 0) {
    await deps.charge({
      billing,
      userId: context.userId,
      workspaceId: context.workspaceId,
      operationId: `monid.run:${run.runId}`,
      providerCostUsd: costUsd,
      modelId,
    })
    chargedUsd = deps.billableCents(costUsd) / 100
  }
  const cost = chargedUsd > 0 ? { chargedUsd: Number(chargedUsd.toFixed(4)) } : { chargedUsd: 0 }

  if (run.status !== 'COMPLETED') {
    const messages: Record<string, string> = {
      FAILED: 'Monid could not complete the run.',
      BLOCKED: run.reason ?? 'A spending control stopped the run.',
      STOPPED: 'The run was stopped before it finished.',
      TIMED_OUT: 'The endpoint took too long and the run timed out.',
    }
    if (run.status === 'BLOCKED') logger.error('[monid] run blocked by a Monid workspace control', { runId: run.runId, reason: run.reason })
    return { success: false as const, error: run.status.toLowerCase(), message: messages[run.status] ?? `The run ended as ${run.status}.`, runId: run.runId, ...cost }
  }

  const httpStatus = run.providerResponse?.httpStatus
  if (typeof httpStatus === 'number' && httpStatus >= 400) {
    return {
      success: false as const,
      error: 'provider_error',
      message: `The provider answered HTTP ${httpStatus}. Check the input against inspect_api and try again.`,
      providerError: truncateJson(run.providerResponse?.error, 4_000),
      runId: run.runId,
      ...cost,
    }
  }

  const owner = {
    userId: context.userId,
    workspaceId: context.workspaceId,
    scope: context.sharedRoom ? 'workspace' as const : 'personal' as const,
    byAgent: Boolean(context.agentId),
  }
  const baseName = `${run.provider}${run.endpoint}`.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'api-result'
  const files: SavedApiFile[] = []
  const fileErrors: string[] = []
  const output = await replaceArtifacts(run.output, async (artifact, index) => {
    if (files.length >= MAX_OUTPUT_FILES) return null
    try {
      const downloaded = await deps.download(artifact.download_link)
      const mimeType = (artifact.content_type ?? downloaded.mimeType ?? 'application/octet-stream').split(';')[0]!.trim()
      const name = artifactFileName(artifact.download_link, mimeType, `${baseName}-${index + 1}`)
      const fileId = await deps.saveBytes({ ...owner, bytes: downloaded.bytes, name, mimeType })
      const saved = { fileId, url: fileUrl(fileId), name, mimeType, sizeBytes: downloaded.bytes.byteLength }
      files.push(saved)
      return saved
    } catch (error) {
      fileErrors.push(errorMessage(error))
      return null
    }
  })

  const fileLinks = fileLinksIn(output)
  const outputText = JSON.stringify(output ?? null)
  let shapedOutput: unknown = output
  let fullOutput: { fileId: string; url: string; name: string } | undefined
  if (outputText.length > MAX_INLINE_OUTPUT_CHARS) {
    const name = `${baseName}-${run.runId}.json`
    try {
      const fileId = await deps.saveText({ ...owner, text: JSON.stringify(output, null, 2), name, mimeType: 'application/json' })
      fullOutput = { fileId, url: fileUrl(fileId), name }
    } catch (error) {
      fileErrors.push(errorMessage(error))
    }
    shapedOutput = previewOutput(output)
  }

  return compact({
    success: true as const,
    runId: run.runId,
    provider: run.provider,
    endpoint: run.endpoint,
    ...cost,
    resultCount: run.resultCount,
    output: shapedOutput,
    outputTruncated: fullOutput || outputText.length > MAX_INLINE_OUTPUT_CHARS ? true : undefined,
    fullOutputFile: fullOutput,
    files: files.length ? files : undefined,
    fileLinks: fileLinks.length ? fileLinks : undefined,
    saveHint: fileLinks.length
      ? 'The output links to files that are not saved yet. Save the ones the user wants (one format is usually enough) with save_api_file and this runId.'
      : undefined,
    fileErrors: fileErrors.length ? fileErrors : undefined,
    note: fullOutput
      ? `The whole output is saved in Files as ${fullOutput.name}; read it with read_file. Only a preview is shown here.`
      : undefined,
  })
}

/** Monid's `maxCost` is in provider dollars: the workspace's remaining budget with Overlay's markup taken back out. */
async function maxCostUsd(remainingCents: number, deps: MonidToolDeps): Promise<number | undefined> {
  if (!await deps.billingEnabled()) return undefined
  if (!Number.isFinite(remainingCents)) return undefined
  const providerDollars = Math.max(0, remainingCents) / 100 / (1 + deps.markupBasisPoints() / 10_000)
  return Math.floor(providerDollars * 1_000_000) / 1_000_000
}

// ── Errors ───────────────────────────────────────────────────────────────────

function failure(error: string, message: string): Failure {
  return { success: false, error, message }
}

function unavailable(): Failure {
  return failure('service_unavailable', 'Data and APIs are not available on this Overlay deployment.')
}

function monidFailure(error: unknown, tool: string): Failure {
  if (error instanceof MonidApiError) {
    if (error.status === 400) return failure('invalid_input', error.message)
    if (error.status === 404) return failure('not_found', 'No such endpoint. Find one with search_apis.')
    if (error.status === 429) return failure('rate_limited', 'The API service is busy. Wait a little and try again.')
    if (error.status === 422) return failure('invalid_input', error.message)
    if (error.status === 402 || error.status === 401 || error.status === 403) {
      // Overlay's own Monid account needs attention (wallet empty, key revoked): every workspace is affected.
      logger.error('[monid] account problem', { tool, status: error.status, code: error.code })
      return failure('service_unavailable', 'Data and APIs are temporarily unavailable. Tell the user to try again later.')
    }
    logger.warn('[monid] request failed', { tool, status: error.status, code: error.code })
    return failure('service_error', 'The API service failed. Try again shortly.')
  }
  logger.warn('[monid] request failed', { tool, error: errorMessage(error) })
  return failure('service_error', 'The API service could not be reached. Try again shortly.')
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function typicalSeconds(ms: number | undefined): number | undefined {
  return typeof ms === 'number' && Number.isFinite(ms) ? Math.max(1, Math.round(ms / 1000)) : undefined
}

function truncateJson(value: unknown, max: number): unknown {
  if (value === undefined) return undefined
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > max ? `${text.slice(0, max)}…` : value
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export { describePrice, replaceArtifacts }
export type { MonidToolDeps }
