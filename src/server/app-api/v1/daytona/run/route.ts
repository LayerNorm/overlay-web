import { logger } from '@/server/observability/logger'
import type { Sandbox } from '@daytonaio/sdk'
import { NextRequest, NextResponse } from 'next/server'
import type { AppApiRouteContext } from '@/server/app-api/bff-context'
import { lazyConvex as convex } from '@/server/database/lazy-convex'
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
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { getOverlaySession } from '@/server/auth/session'
import type { Entitlements } from '@/shared/app/app-contracts'
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

  const serverSecret = getInternalApiSecret()
  let workspaceRun:
    | Awaited<ReturnType<typeof ensureWorkspaceSandbox>>
    | null = null
  let meteringStartedAt: number | null = null
  let meteringEndedAt: number | null = null
  const budgetReservation = await reserveDaytonaRunBudget({
    userId,
    serverSecret,
    maxDurationSeconds: maxDuration,
    deps: {
      getEntitlementsByServer: (args) => convex.query<Entitlements | null>('platform/usage:getEntitlementsByServer', args),
    },
  })
  if (!budgetReservation.ok) {
    return NextResponse.json(budgetReservation.payload, { status: budgetReservation.status })
  }
  const sandboxBudgetReservationId = budgetReservation.reservationId

  try {
    workspaceRun = await ensureWorkspaceSandbox({
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
      findFile: (fileId) => convex.query<OverlayFileRecord | null>('files/files:get', {
        fileId,
        userId,
        serverSecret,
      }),
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
      createOutput: (args) => convex.mutation<string | null>('outputs/outputs:create', args),
      deleteObject,
      downloadFile: downloadSandboxFile,
      expectedOutputs,
      findSandboxFile: waitForSandboxFile,
      paths,
      runtime,
      sandbox,
      serverSecret,
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
      workspaceRun,
      meteringStartedAt,
      meteringEndedAt,
      reservationId: sandboxBudgetReservationId,
      userId,
    })
  }
}
