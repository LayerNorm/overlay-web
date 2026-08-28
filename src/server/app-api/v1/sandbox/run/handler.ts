import { logger } from '@/server/observability/logger'
import { posix as pathPosix } from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { getBillingProgrammaticSubjectId, getTrustedAutomationBillingSubjectId, type AppApiRouteContext } from '@/server/app-api/bff-context'
import {
  acquireConcurrentRequestSlot,
  concurrentRequestLimitResponse,
} from '@/server/security/concurrent-request-limiter'
import { getOverlayServerContext } from '@/server/bootstrap'
import { outputService } from '@/server/outputs/http'
import { getOverlaySession } from '@/server/auth/session'
import { deleteObject, generatePresignedDownloadUrl, uploadBuffer as uploadBufferToR2 } from '@/server/storage/object-store'
import { checkGlobalR2Budget } from '@/server/storage/r2-budget'
import {
  buildInsufficientCreditsPayload,
  billableBudgetCentsFromProviderUsd,
  ensureBudgetAvailable,
  getBudgetTotals,
  isPaidPlan,
  reserveProviderBudget,
} from '@/server/billing/billing-runtime'
import type { Entitlements } from '@/shared/app/app-contracts'
import type { SandboxInstance, SandboxUsage } from '@overlay/sandbox-runtime'
import { managedSandboxRuntimeFromEnv } from '@/server/agents/ManagedAgentSandboxService'
import {
  calculateVercelSandboxCostUsd,
  estimateVercelSandboxReservationUsd,
  sandboxProviderCostLimitUsd,
} from '@/server/ai/sandbox/vercel-pricing'
import { buildSandboxEgressGuardedCommand } from '@/server/ai/sandbox/egress-guard'
import { sandboxRunMaxEgressBytes, sandboxRunNetworkPolicy } from '@/server/ai/sandbox/run-policy'
import {
  buildDaytonaRunResult,
  collectDaytonaArtifacts,
  type OverlayFileRecord,
  stageDaytonaInputFiles,
  stageInlineCodeFile,
} from '../../daytona/run/sandbox-runner'
import { MAX_ARTIFACT_BYTES, parseDaytonaRunRequest } from '../../daytona/run/request'

export const SANDBOX_MAX_DURATION_SECONDS = 300

// Provider-agnostic sandbox paths. These differ from Daytona's /home/daytona/workspace
// layout — Vercel sandboxes use /sandbox as the default working directory.
const SANDBOX_ROOT_DIR = '/sandbox/overlay'
const SANDBOX_INPUT_DIR = '/sandbox/overlay/inputs'
const SANDBOX_RUN_DIR = '/sandbox/overlay/run'
const SANDBOX_OUTPUT_DIR = '/sandbox/overlay/outputs'
const SANDBOX_STDOUT_PATH = '/sandbox/overlay/.stdout'
const SANDBOX_STDERR_PATH = '/sandbox/overlay/.stderr'
const SANDBOX_EGRESS_LIMIT_MARKER_PATH = '/sandbox/overlay/.egress-limit-exceeded'

const SANDBOX_RESOURCES = { memoryGb: 4, vcpus: 2 }

async function readOverlayFileBuffer(file: OverlayFileRecord): Promise<Buffer> {
  if (file.r2Key) {
    const url = await generatePresignedDownloadUrl(file.r2Key)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to download Overlay file "${file.name}" from R2.`)
    }
    return Buffer.from(await response.arrayBuffer())
  }
  if (file.storageId) {
    throw new Error(`Legacy Convex storage imports are disabled for "${file.name}". Re-upload this file to Overlay storage.`)
  }
  return Buffer.from(file.content ?? '', 'utf8')
}

async function waitForSandboxFile(
  sandbox: SandboxInstance,
  remotePath: string,
  attempts = 5,
  delayMs = 300,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const entries = await sandbox.listFiles(pathPosix.dirname(remotePath))
      const details = entries.find((entry) => entry.path === remotePath)
      if (details && details.kind !== 'directory') return { isDir: false, sizeBytes: details.size }
    } catch (_error) {
      // retry
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  return null
}

export async function handleSandboxRunPost(request: NextRequest, context: AppApiRouteContext) {
  const runtime = managedSandboxRuntimeFromEnv()

  // Delegate to the existing Daytona route for Daytona provider — it has
  // workspace persistence, Daytona-specific pricing, and lifecycle management
  // that should not be reimplemented here.
  if (runtime.provider === 'daytona') {
    const { POST: daytonaPost } = await import('../../daytona/run/route')
    return daytonaPost(request, context)
  }

  // Vercel sandbox path — create a fresh sandbox per request.
  const session = await getOverlaySession(request)
  const parsedRequest = parseDaytonaRunRequest(await request.json())
  if (!parsedRequest.ok) {
    if (parsedRequest.error.warning) {
      logger.warn(parsedRequest.error.warning.message, parsedRequest.error.warning.details)
    }
    return NextResponse.json(parsedRequest.error.payload, { status: parsedRequest.error.status })
  }
  const {
    task,
    runtime: sandboxRuntime,
    command,
    code,
    inputFileIds,
    expectedOutputs,
    conversationId,
    turnId,
  } = parsedRequest.value

  let userId: string | null = session?.user.id ?? null
  if (!userId) {
    const { auth } = context
    userId = auth?.userId ?? null
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const concurrencySlot = acquireConcurrentRequestSlot(userId, {
    bucket: 'sandbox-run',
    maxConcurrent: 2,
    maxDurationMs: 360_000,
  })
  if (!concurrencySlot) {
    return concurrentRequestLimitResponse('sandbox-run')
  }

  const { generationUsagePolicy } = getOverlayServerContext()
  let meteringEndedAt: number | null = null
  const networkPolicy = sandboxRunNetworkPolicy()
  const maxCommandEgressBytes = networkPolicy.mode === 'deny_all' ? 0 : sandboxRunMaxEgressBytes()
  const maxArtifactEgressBytes = expectedOutputs.length * MAX_ARTIFACT_BYTES

  const estimatedProviderCostUsd = estimateVercelSandboxReservationUsd({
    includeCreation: true,
    // Artifact downloads happen after the user command, so reserve their
    // independent bounded transfer in addition to the command egress guard.
    maxEgressBytes: maxCommandEgressBytes + maxArtifactEgressBytes,
    maxRunTimeMs: SANDBOX_MAX_DURATION_SECONDS * 1_000,
    memoryGb: SANDBOX_RESOURCES.memoryGb,
    vcpus: SANDBOX_RESOURCES.vcpus,
  })
  if (estimatedProviderCostUsd > sandboxProviderCostLimitUsd()) {
    concurrencySlot.release()
    return NextResponse.json({
      error: 'sandbox_provider_cost_limit',
      message: 'Sandbox execution exceeds the configured provider-cost safety limit.',
    }, { status: 503 })
  }

  // Reserve for the worst-case configured Vercel CPU, memory, egress, and
  // creation usage before starting provider work.
  const budgetReservation = await reserveSandboxBudget({
    userId,
    workspaceId: context.workspace.workspace.id,
    programmaticSubjectId: getBillingProgrammaticSubjectId(context, getTrustedAutomationBillingSubjectId(context)),
    idempotencyKey: context.requestIdempotencyKey,
    operationId: 'sandbox.run',
    requestFingerprint: context.requestFingerprint,
    providerCostUsd: estimatedProviderCostUsd,
    deps: {
      getEntitlementsByServer: (args) => generationUsagePolicy.getEntitlements(args),
      ensureBudgetAvailable: (args) => generationUsagePolicy.ensureBudgetAvailable({
        ...args,
        minimumRequiredCents: args.minimumRequiredCents ?? 1,
      }),
      reserveProviderBudget: (args) => generationUsagePolicy.reserve(args),
    },
  })
  if (!budgetReservation.ok) {
    concurrencySlot?.release()
    return NextResponse.json(budgetReservation.payload, { status: budgetReservation.status })
  }
  const sandboxBudgetReservationId = budgetReservation.reservationId
  let sandbox: SandboxInstance | null = null
  try {
    await generationUsagePolicy.markStarted({
      userId,
      reservationId: sandboxBudgetReservationId,
    })

    // Create a fresh Vercel sandbox for this request.
    sandbox = await runtime.create({
      name: `overlay-sandbox-${userId}-${Date.now()}`,
      persistent: false,
      hardTimeoutMs: SANDBOX_MAX_DURATION_SECONDS * 1_000,
      idleTimeoutMs: 0,
      networkPolicy,
      resources: { vcpus: SANDBOX_RESOURCES.vcpus, memoryGiB: SANDBOX_RESOURCES.memoryGb },
      metadata: {
        'overlay.userId': userId,
        'overlay.workspaceId': context.workspace.workspace.id,
        'overlay.operation': 'sandbox.run',
      },
    })

    const paths = {
      rootDir: SANDBOX_ROOT_DIR,
      inputDir: SANDBOX_INPUT_DIR,
      runDir: SANDBOX_RUN_DIR,
      outputDir: SANDBOX_OUTPUT_DIR,
      stdoutPath: SANDBOX_STDOUT_PATH,
      stderrPath: SANDBOX_STDERR_PATH,
    }

    await prepareSandboxWorkspace(sandbox, paths)

    const uploadedFiles = await stageDaytonaInputFiles({
      fileIds: inputFileIds,
      findFile: (fileId) => Promise.resolve(
        getOverlayServerContext().appData.repositories.files.getFile({
          fileId,
          userId,
        }) as Promise<OverlayFileRecord | null>,
      ),
      paths,
      readFileBuffer: readOverlayFileBuffer,
      sandbox,
      uploadBuffer: uploadSandboxBuffer,
    })

    const inlineCodePath = await stageInlineCodeFile({
      code,
      paths,
      runtime: sandboxRuntime,
      sandbox,
      uploadBuffer: uploadSandboxBuffer,
    })

    const execution = await (async () => {
      try {
        return await executeSandboxCommand(sandbox, {
          command,
          cwd: paths.rootDir,
          environment: {
            OVERLAY_TASK: task,
            OVERLAY_WORK_DIR: paths.rootDir,
            OVERLAY_INPUT_DIR: paths.inputDir,
            OVERLAY_RUN_DIR: paths.runDir,
            OVERLAY_OUTPUT_DIR: paths.outputDir,
            ...(inlineCodePath ? { OVERLAY_INLINE_CODE_PATH: inlineCodePath } : {}),
          },
          stdoutPath: paths.stdoutPath,
          stderrPath: paths.stderrPath,
          timeoutMs: SANDBOX_MAX_DURATION_SECONDS * 1_000,
          maxEgressBytes: maxCommandEgressBytes,
          egressLimitMarkerPath: SANDBOX_EGRESS_LIMIT_MARKER_PATH,
        })
      } finally {
        meteringEndedAt = Date.now()
      }
    })()

    const { artifacts, missingExpectedOutputs } = await collectDaytonaArtifacts({
      checkGlobalBudget: checkGlobalR2Budget,
      command,
      conversationId,
      createOutput: (args) => outputService.create({ ...args, workspaceId: context.workspace.workspace.id } as Parameters<typeof outputService.create>[0]),
      deleteObject,
      downloadFile: downloadSandboxFile,
      expectedOutputs,
      findSandboxFile: waitForSandboxFile,
      requireKnownSizeBeforeDownload: true,
      paths,
      runtime: sandboxRuntime,
      sandbox,
      serverSecret: '',
      task,
      turnId,
      uploadObject: uploadBufferToR2,
      userId,
    })

    const result = buildDaytonaRunResult({
      artifacts,
      execution,
      missingExpectedOutputs,
      sandboxId: sandbox.reference,
      uploadedFiles,
      workspaceState: 'active',
    })
    return NextResponse.json(result.payload, { status: result.status })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Sandbox execution failed.',
        ...(sandbox?.reference ? { sandboxId: sandbox.reference } : {}),
      },
      { status: 500 },
    )
  } finally {
    // Stop first because Vercel reports the final session CPU and transfer
    // counters only after the VM has stopped.
    let finalUsage = null
    let usageError: unknown = null
    if (sandbox) {
      try {
        await sandbox.stop?.()
        finalUsage = await sandbox.usage()
      } catch (error) {
        usageError = error
      }
    }

    if (sandboxBudgetReservationId) {
      try {
        if (usageError || !hasCompleteVercelUsage(finalUsage)) {
          throw usageError instanceof Error ? usageError : new Error('Vercel sandbox usage was incomplete after stop')
        }
        const actualCostUsd = calculateVercelSandboxCostUsd({
          includeCreation: true,
          memoryGb: SANDBOX_RESOURCES.memoryGb,
          usage: finalUsage,
        })
        const billedDurationSeconds = Math.ceil(finalUsage.wallTimeMs / 1_000)
        await generationUsagePolicy.finalize({
          actualProviderCostUsd: actualCostUsd,
          events: [{
            type: 'sandbox',
            modelId: 'vercel/sandbox',
            cost: billableBudgetCentsFromProviderUsd(actualCostUsd),
            durationSeconds: billedDurationSeconds,
            timestamp: meteringEndedAt ?? Date.now(),
          }],
          userId,
          reservationId: sandboxBudgetReservationId,
        })
      } catch (finalizeError) {
        logger.error('[Sandbox] Budget finalize failed:', finalizeError)
        await generationUsagePolicy.markForReconcile({
          userId,
          reservationId: sandboxBudgetReservationId,
          errorMessage: finalizeError instanceof Error
            ? `vercel_sandbox_finalize:${finalizeError.message}`
            : 'vercel_sandbox_finalize_failed',
        }).catch((_error) => undefined)
      }
    }
    concurrencySlot?.release()
  }
}

// --- Budget reservation (provider-agnostic, flat-rate) ---

type SandboxBudgetDeps = {
  ensureBudgetAvailable(params: {
    userId: string
    entitlements: Entitlements
    minimumRequiredCents?: number
    programmaticSubjectId?: string
    workspaceId?: string
  }): Promise<{ entitlements: Entitlements; remainingCents: number }>
  getBudgetTotals: typeof getBudgetTotals
  getEntitlementsByServer(params: {
    programmaticSubjectId?: string
    userId: string
    workspaceId?: string
  }): Promise<Entitlements | null>
  isPaidPlan: typeof isPaidPlan
  reserveProviderBudget: typeof reserveProviderBudget
}

async function reserveSandboxBudget(params: {
  deps: Partial<SandboxBudgetDeps>
  idempotencyKey?: string | null
  operationId: string
  providerCostUsd: number
  requestFingerprint: string
  programmaticSubjectId?: string
  userId: string
  workspaceId?: string
}): Promise<
  | { ok: true; billingAccountId: string | null; reservationId: string | null }
  | { ok: false; payload: Record<string, unknown>; status: number }
> {
  const ensureBudgetAvailableFn = params.deps.ensureBudgetAvailable ?? ensureBudgetAvailable
  const getBudgetTotalsFn = params.deps.getBudgetTotals ?? getBudgetTotals
  const getEntitlementsByServerFn = params.deps.getEntitlementsByServer ?? (async () => null)
  const isPaidPlanFn = params.deps.isPaidPlan ?? isPaidPlan
  const reserveProviderBudgetFn = params.deps.reserveProviderBudget ?? reserveProviderBudget

  let currentEntitlements = await getEntitlementsByServerFn({
    programmaticSubjectId: params.programmaticSubjectId,
    userId: params.userId,
    workspaceId: params.workspaceId,
  })

  if (!currentEntitlements) {
    return {
      ok: false,
      payload: { error: 'Unauthorized', message: 'Could not verify subscription. Try signing out and back in.' },
      status: 401,
    }
  }
  if (!isPaidPlanFn(currentEntitlements)) {
    return {
      ok: false,
      payload: { error: 'sandbox_not_allowed', message: 'Sandbox execution requires a paid plan.' },
      status: 403,
    }
  }

  let budget = getBudgetTotalsFn(currentEntitlements)
  if (budget.remainingCents <= 0) {
    const autoTopUp = await ensureBudgetAvailableFn({
      userId: params.userId,
      entitlements: currentEntitlements,
      minimumRequiredCents: 1,
      programmaticSubjectId: params.programmaticSubjectId,
      workspaceId: params.workspaceId,
    })
    currentEntitlements = autoTopUp.entitlements
    budget = getBudgetTotalsFn(currentEntitlements)
  }
  if (budget.remainingCents <= 0) {
    return {
      ok: false,
      payload: buildInsufficientCreditsPayload(currentEntitlements, 'No budget remaining. Please top up your account.'),
      status: 402,
    }
  }

  const sandboxReservation = await reserveProviderBudgetFn({
    userId: params.userId,
    entitlements: currentEntitlements,
    idempotencyKey: params.idempotencyKey,
    providerCostUsd: params.providerCostUsd,
    kind: 'sandbox',
    modelId: 'vercel/sandbox',
    operationId: params.operationId,
    requestFingerprint: params.requestFingerprint,
    programmaticSubjectId: params.programmaticSubjectId,
    workspaceId: params.workspaceId,
  })
  if (!sandboxReservation.ok) {
    return {
      ok: false,
      payload: { ...sandboxReservation.payload, error: sandboxReservation.code },
      status: sandboxReservation.status,
    }
  }
  return {
    ok: true,
    billingAccountId: sandboxReservation.billingAccountId,
    reservationId: sandboxReservation.reservationId,
  }
}

// --- Sandbox helpers (provider-agnostic via SandboxInstance) ---

async function uploadSandboxBuffer(
  sandbox: SandboxInstance,
  remotePath: string,
  contents: Buffer | string,
) {
  await sandbox.writeFiles([{ path: remotePath, contents: typeof contents === 'string' ? Buffer.from(contents) : contents }])
}

async function downloadSandboxFile(sandbox: SandboxInstance, remotePath: string) {
  const contents = await sandbox.readFile(remotePath)
  if (!contents) throw new Error(`Sandbox file not found: ${remotePath}`)
  return Buffer.from(contents)
}

async function prepareSandboxWorkspace(
  sandbox: SandboxInstance,
  paths: { inputDir: string; runDir: string; outputDir: string },
) {
  const handle = await sandbox.runCommand({
    command: '/bin/sh',
    args: ['-lc', `mkdir -p "$OVERLAY_INPUT_DIR" "$OVERLAY_RUN_DIR" "$OVERLAY_OUTPUT_DIR" && rm -rf "$OVERLAY_INPUT_DIR"/* "$OVERLAY_RUN_DIR"/* "$OVERLAY_OUTPUT_DIR"/*`],
    environment: {
      OVERLAY_INPUT_DIR: paths.inputDir,
      OVERLAY_RUN_DIR: paths.runDir,
      OVERLAY_OUTPUT_DIR: paths.outputDir,
    },
    timeoutMs: 30_000,
  })
  const result = await handle.wait()
  if (result.exitCode !== 0) throw new Error(result.stderr || 'Failed to prepare sandbox workspace')
}

async function executeSandboxCommand(sandbox: SandboxInstance, input: {
  command: string
  cwd: string
  egressLimitMarkerPath: string
  environment: Record<string, string>
  maxEgressBytes: number
  stdoutPath: string
  stderrPath: string
  timeoutMs: number
}) {
  const commandPath = pathPosix.join(input.cwd, '.overlay-command.sh')
  await sandbox.writeFiles([{
    path: commandPath,
    contents: Buffer.from(`#!/usr/bin/env bash\nset -o pipefail\n${input.command.trimEnd()}\n`),
    mode: 0o700,
  }])
  const wrapped = buildSandboxEgressGuardedCommand({
    commandPath,
    markerPath: input.egressLimitMarkerPath,
    maxEgressBytes: input.maxEgressBytes,
    stderrPath: input.stderrPath,
    stdoutPath: input.stdoutPath,
  })
  const handle = await sandbox.runCommand({
    command: '/bin/sh',
    args: ['-lc', wrapped],
    cwd: input.cwd,
    environment: input.environment,
    timeoutMs: input.timeoutMs,
  })
  const result = await handle.wait()
  const stderr = await sandbox.readFile(input.stderrPath).catch((_error) => null)
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: stderr ? Buffer.from(stderr).toString('utf8') : result.stderr,
  }
}

function hasCompleteVercelUsage(usage: SandboxUsage | null): usage is Required<Pick<SandboxUsage, 'wallTimeMs' | 'activeCpuTimeMs' | 'egressBytes'>> & SandboxUsage {
  return usage !== null
    && typeof usage.wallTimeMs === 'number' && Number.isFinite(usage.wallTimeMs)
    && typeof usage.activeCpuTimeMs === 'number' && Number.isFinite(usage.activeCpuTimeMs)
    && typeof usage.egressBytes === 'number' && Number.isFinite(usage.egressBytes)
}
