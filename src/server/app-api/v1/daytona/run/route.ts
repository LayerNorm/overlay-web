import { logger } from '@/server/observability/logger'
import { wrapDaytonaSandbox } from '@overlay/sandbox-runtime/daytona'
import type { SandboxInstance } from '@overlay/sandbox-runtime'
import { posix as pathPosix } from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { getBillingProgrammaticSubjectId, getTrustedAutomationBillingSubjectId, type AppApiRouteContext } from '@/server/app-api/bff-context'
import {
  acquireConcurrentRequestSlot,
  concurrentRequestLimitResponse,
} from '@/server/security/concurrent-request-limiter'
import {
  ensureWorkspaceSandbox,
  getSandboxPaths,
  refreshWorkspaceActivity,
  startIfNeeded,
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
  sandbox: SandboxInstance,
  remotePath: string,
  attempts = 5,
  delayMs = 300,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const entries = await sandbox.listFiles(pathPosix.dirname(remotePath))
      const details = entries.find((entry) => entry.path === remotePath)
      if (details && details.kind !== 'directory') return { isDir: false }
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

  // Per-user concurrent request limit. Sandbox tasks can run for up to 300
  // seconds; without a concurrency cap, a user could fire multiple parallel
  // sandbox executions and consume significant resources.
  const concurrencySlot = acquireConcurrentRequestSlot(userId, {
    bucket: 'daytona-run',
    maxConcurrent: 2,
    maxDurationMs: 360_000, // 6 minutes (covers maxDuration=300s + buffer)
  })
  if (!concurrencySlot) {
    return concurrentRequestLimitResponse('daytona-run')
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
    const runtimeSandbox = wrapDaytonaSandbox(sandbox)
    const paths = await getSandboxPaths(sandbox)
    meteringStartedAt = workspaceRun.workspace.lastMeteredAt ?? Date.now()
    await prepareRuntimeWorkspace(runtimeSandbox, paths)

    const uploadedFiles = await stageDaytonaInputFiles({
      fileIds: inputFileIds,
      findFile: (fileId) => appData.repositories.files.getFile({
        fileId,
        userId,
      }) as Promise<OverlayFileRecord | null>,
      paths,
      readFileBuffer: readOverlayFileBuffer,
      sandbox: runtimeSandbox,
      uploadBuffer: uploadRuntimeBuffer,
    })

    const inlineCodePath = await stageInlineCodeFile({
      code,
      paths,
      runtime,
      sandbox: runtimeSandbox,
      uploadBuffer: uploadRuntimeBuffer,
    })

    const normalizedCommand = command
    const normalizedTask = task
    const execution = await (async () => {
      try {
        return await executeRuntimeCommand(runtimeSandbox, {
          command: normalizedCommand,
          cwd: paths.rootDir,
          environment: {
            OVERLAY_TASK: normalizedTask,
            OVERLAY_WORK_DIR: paths.rootDir,
            OVERLAY_INPUT_DIR: paths.inputDir,
            OVERLAY_RUN_DIR: paths.runDir,
            OVERLAY_OUTPUT_DIR: paths.outputDir,
            ...(inlineCodePath ? { OVERLAY_INLINE_CODE_PATH: inlineCodePath } : {}),
          },
          stdoutPath: paths.stdoutPath,
          stderrPath: paths.stderrPath,
          timeoutMs: maxDuration * 1_000,
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
      downloadFile: downloadRuntimeFile,
      expectedOutputs,
      findSandboxFile: waitForSandboxFile,
      paths,
      runtime,
      sandbox: runtimeSandbox,
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
    concurrencySlot?.release()
  }
}

async function uploadRuntimeBuffer(
  sandbox: SandboxInstance,
  remotePath: string,
  contents: Buffer | string,
) {
  await sandbox.writeFiles([{ path: remotePath, contents: typeof contents === 'string' ? Buffer.from(contents) : contents }])
}

async function downloadRuntimeFile(sandbox: SandboxInstance, remotePath: string) {
  const contents = await sandbox.readFile(remotePath)
  if (!contents) throw new Error(`Sandbox file not found: ${remotePath}`)
  return Buffer.from(contents)
}

async function prepareRuntimeWorkspace(sandbox: SandboxInstance, paths: Awaited<ReturnType<typeof getSandboxPaths>>) {
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

async function executeRuntimeCommand(sandbox: SandboxInstance, input: {
  command: string
  cwd: string
  environment: Record<string, string>
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
  const wrapped = [
    `mkdir -p ${shellQuote(pathPosix.dirname(input.stdoutPath))}`,
    `bash ${shellQuote(commandPath)} > ${shellQuote(input.stdoutPath)} 2> ${shellQuote(input.stderrPath)}`,
    'EXIT_CODE=$?',
    `if [ -f ${shellQuote(input.stdoutPath)} ]; then cat ${shellQuote(input.stdoutPath)}; fi`,
    'exit $EXIT_CODE',
  ].join('; ')
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

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
