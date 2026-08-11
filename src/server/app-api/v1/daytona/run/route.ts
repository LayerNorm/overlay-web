import { logger } from '@/server/observability/logger'
import type { Sandbox } from '@daytona/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { getBillingProgrammaticSubjectId, getTrustedAutomationBillingSubjectId, type AppApiRouteContext } from '@/server/app-api/bff-context'
import {
  downloadSandboxFile,
  ensureWorkspaceSandbox,
  executeSandboxCommand,
  getSandboxPaths,
  prepareSandboxWorkspace,
  refreshWorkspaceActivity,
  startIfNeeded,
  uploadSandboxBuffer,
} from '@/server/ai/sandbox/daytona'
import { getOverlayServerContext } from '@/server/bootstrap'
import { outputService } from '@/server/outputs/http'
import { getOverlaySession } from '@/server/auth/session'
import { deleteObject, generatePresignedDownloadUrl, uploadBuffer as uploadBufferToR2 } from '@/server/storage/object-store'
import { checkGlobalR2Budget } from '@/server/storage/r2-budget'
import { finalizeDaytonaRunMetering, reserveDaytonaRunBudget } from './lifecycle'
import {
  buildDaytonaRunResult,
  collectDaytonaArtifacts,
  type OverlayFileRecord,
  stageDaytonaInputFiles,
  stageInlineCodeFile,
} from './sandbox-runner'
import { parseDaytonaRunRequest } from './request'

export const maxDuration = 300

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
  sandbox: Sandbox,
  remotePath: string,
  attempts = 5,
  delayMs = 300,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const details = await sandbox.fs.getFileDetails(remotePath)
      if (details && !details.isDir) {
        return details
      }
    } catch (_error) {
      // retry
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  return null
}

export async function POST(request: NextRequest, context: AppApiRouteContext) {
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
    runtime,
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

  const { appData, generationUsagePolicy } = getOverlayServerContext()
  let workspaceRun:
    | Awaited<ReturnType<typeof ensureWorkspaceSandbox>>
    | null = null
  let meteringStartedAt: number | null = null
  let meteringEndedAt: number | null = null
  const budgetReservation = await reserveDaytonaRunBudget({
    userId,
    workspaceId: context.workspace.workspace.id,
    programmaticSubjectId: getBillingProgrammaticSubjectId(context, getTrustedAutomationBillingSubjectId(context)),
    idempotencyKey: context.requestIdempotencyKey,
    maxDurationSeconds: maxDuration,
    operationId: 'sandbox.daytona-run',
    requestFingerprint: context.requestFingerprint,
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
    return NextResponse.json(budgetReservation.payload, { status: budgetReservation.status })
  }
  const sandboxBudgetReservationId = budgetReservation.reservationId
  const sandboxBillingAccountId = budgetReservation.billingAccountId

  try {
    await generationUsagePolicy.markStarted({
      userId,
      reservationId: sandboxBudgetReservationId,
    })
    workspaceRun = await ensureWorkspaceSandbox({
      repository: appData.repositories.daytonaWorkspaces,
      userId,
      tier: 'pro',
    })
    workspaceRun = await startIfNeeded(workspaceRun)
    await refreshWorkspaceActivity(workspaceRun)

    const sandbox = workspaceRun.sandbox
    const paths = await getSandboxPaths(sandbox)
    meteringStartedAt = workspaceRun.workspace.lastMeteredAt ?? Date.now()
    await prepareSandboxWorkspace(sandbox, paths)

    const uploadedFiles = await stageDaytonaInputFiles({
      fileIds: inputFileIds,
      findFile: (fileId) => appData.repositories.files.getFile({
        fileId,
        userId,
      }) as Promise<OverlayFileRecord | null>,
      paths,
      readFileBuffer: readOverlayFileBuffer,
      sandbox,
      uploadBuffer: uploadSandboxBuffer,
    })

    const inlineCodePath = await stageInlineCodeFile({
      code,
      paths,
      runtime,
      sandbox,
      uploadBuffer: uploadSandboxBuffer,
    })

    const normalizedCommand = command
    const normalizedTask = task
    const execution = await (async () => {
      try {
        return await executeSandboxCommand(sandbox, {
          command: normalizedCommand,
          cwd: paths.rootDir,
          env: {
            OVERLAY_TASK: normalizedTask,
            OVERLAY_WORK_DIR: paths.rootDir,
            OVERLAY_INPUT_DIR: paths.inputDir,
            OVERLAY_RUN_DIR: paths.runDir,
            OVERLAY_OUTPUT_DIR: paths.outputDir,
            ...(inlineCodePath ? { OVERLAY_INLINE_CODE_PATH: inlineCodePath } : {}),
          },
          stdoutPath: paths.stdoutPath,
          stderrPath: paths.stderrPath,
        })
      } finally {
        meteringEndedAt = Date.now()
      }
    })()

    const { artifacts, missingExpectedOutputs } = await collectDaytonaArtifacts({
      checkGlobalBudget: checkGlobalR2Budget,
      command: normalizedCommand,
      conversationId,
      createOutput: (args) => outputService.create({ ...args, workspaceId: context.workspace.workspace.id } as Parameters<typeof outputService.create>[0]),
      deleteObject,
      downloadFile: downloadSandboxFile,
      expectedOutputs,
      findSandboxFile: waitForSandboxFile,
      paths,
      runtime,
      sandbox,
      serverSecret: '',
      task: normalizedTask,
      turnId,
      uploadObject: uploadBufferToR2,
      userId,
    })
    const result = buildDaytonaRunResult({
      artifacts,
      execution,
      missingExpectedOutputs,
      sandboxId: sandbox.id,
      uploadedFiles,
      workspaceState: workspaceRun.workspace.state,
    })
    return NextResponse.json(result.payload, { status: result.status })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Daytona sandbox execution failed.',
        ...(workspaceRun?.sandbox.id ? { sandboxId: workspaceRun.sandbox.id } : {}),
      },
      { status: 500 },
    )
  } finally {
    await finalizeDaytonaRunMetering({
      billingAccountId: sandboxBillingAccountId,
      workspaceRun,
      meteringStartedAt,
      meteringEndedAt,
      reservationId: sandboxBudgetReservationId,
      userId,
      deps: {
        finalizeProviderBudgetReservation: (args) => generationUsagePolicy.finalize(args),
        releaseProviderBudgetReservation: (args) => generationUsagePolicy.release(args),
        markProviderBudgetReconcile: (args) => generationUsagePolicy.markForReconcile(args),
      },
    })
  }
}
