import 'server-only'

import { logger } from '@/server/observability/logger'
import { posix as pathPosix } from 'node:path'
import {
  CodeLanguage,
  type CreateSandboxFromSnapshotParams,
  Daytona,
  type Resources,
  type Sandbox,
  type VolumeMount,
} from '@daytonaio/sdk'
import type {
  DaytonaWorkspaceRecord,
  DaytonaWorkspaceRepository,
} from './DaytonaWorkspaceRepository'
import {
  detectDaytonaResourceProfileId,
  getDaytonaResourceProfile,
  type DaytonaResourceProfile,
  type DaytonaUsageReason,
  type DaytonaWorkspaceState,
  type DaytonaWorkspaceTier,
} from './daytona-pricing'

export type DaytonaRuntime = 'node' | 'python'

export const WORKSPACE_MOUNT_PATH = '/home/daytona/workspace'
export const WORKSPACE_ROOT_DIR = '/home/daytona/workspace/overlay'
export const WORKSPACE_INPUT_DIR = '/home/daytona/workspace/overlay/inputs'
export const WORKSPACE_RUN_DIR = '/home/daytona/workspace/overlay/run'
export const WORKSPACE_OUTPUT_DIR = '/home/daytona/workspace/overlay/outputs'

export interface DaytonaPaths {
  workDir: string
  rootDir: string
  inputDir: string
  runDir: string
  outputDir: string
  stdoutPath: string
  stderrPath: string
}

export interface DaytonaVolumeRecord {
  id: string
  name: string
  state?: string
}

export interface EnsuredDaytonaWorkspace {
  workspace: DaytonaWorkspaceRecord
  sandbox: Sandbox
  volume: DaytonaVolumeRecord
  profile: DaytonaResourceProfile
  repository: DaytonaWorkspaceRepository
}

let daytonaClient: Daytona | null = null

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function sanitizeDaytonaName(value: string, maxLength = 55): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')

  return (normalized || 'overlay-workspace').slice(0, maxLength)
}

function buildWorkspaceLabels(userId: string, tier: DaytonaWorkspaceTier): Record<string, string> {
  return {
    overlay: 'true',
    'overlay.kind': 'workspace',
    'overlay.userId': userId,
    'overlay.tier': tier,
  }
}

function getSandboxLanguage(runtime: DaytonaRuntime): CodeLanguage {
  return runtime === 'node' ? CodeLanguage.JAVASCRIPT : CodeLanguage.PYTHON
}

function isSandboxAlreadyExistsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.toLowerCase().includes('sandbox already exists')
}

function isSandboxResizeUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const normalized = message.toLowerCase()
  return normalized.includes('cannot post /api/sandbox/') && normalized.includes('/resize')
}

function normalizeSandboxState(state: Sandbox['state'] | undefined): DaytonaWorkspaceState {
  switch (state) {
    case 'started':
      return 'started'
    case 'stopped':
      return 'stopped'
    case 'archived':
      return 'archived'
    case 'destroyed':
      return 'missing'
    case 'starting':
    case 'stopping':
    case 'creating':
    case 'restoring':
    case 'resizing':
    case 'pending_build':
      return 'provisioning'
    case 'error':
    case 'build_failed':
      return 'error'
    default:
      return 'provisioning'
  }
}

function canHotResizeUp(
  sandbox: Sandbox,
  profile: DaytonaResourceProfile,
): boolean {
  return (
    sandbox.cpu <= profile.cpu &&
    sandbox.memory <= profile.memoryGiB &&
    sandbox.disk === profile.diskGiB
  )
}

async function fetchWorkspaceByUserId(
  repository: DaytonaWorkspaceRepository,
  userId: string,
): Promise<DaytonaWorkspaceRecord | null> {
  return await repository.getByUserId({ userId })
}

async function upsertWorkspaceRecord(repository: DaytonaWorkspaceRepository, input: {
  userId: string
  sandboxId: string
  sandboxName: string
  volumeId: string
  volumeName: string
  tier: DaytonaWorkspaceTier
  state: DaytonaWorkspaceState
  resourceProfile: DaytonaWorkspaceTier
  mountPath: string
  lastMeteredAt?: number
  lastKnownStartedAt?: number
  lastKnownStoppedAt?: number
}): Promise<DaytonaWorkspaceRecord> {
  return await repository.upsert(input)
}

function resolveActualResourceProfile(sandbox: Sandbox, fallback: DaytonaWorkspaceTier): DaytonaWorkspaceTier {
  return detectDaytonaResourceProfileId({
    cpu: sandbox.cpu,
    memoryGiB: sandbox.memory,
    diskGiB: sandbox.disk,
  }) ?? fallback
}

async function syncWorkspaceRecordFromSandbox(params: {
  repository: DaytonaWorkspaceRepository
  userId: string
  tier: DaytonaWorkspaceTier
  sandbox: Sandbox
  volume: DaytonaVolumeRecord
  previousWorkspace?: DaytonaWorkspaceRecord | null
  overrides?: {
    state?: DaytonaWorkspaceState
    lastMeteredAt?: number
    lastKnownStartedAt?: number
    lastKnownStoppedAt?: number
  }
}): Promise<DaytonaWorkspaceRecord> {
  const state = params.overrides?.state ?? normalizeSandboxState(params.sandbox.state)

  return await upsertWorkspaceRecord(params.repository, {
    userId: params.userId,
    sandboxId: params.sandbox.id,
    sandboxName: params.sandbox.name,
    volumeId: params.volume.id,
    volumeName: params.volume.name,
    tier: params.tier,
    state,
    resourceProfile: resolveActualResourceProfile(params.sandbox, params.tier),
    mountPath: WORKSPACE_MOUNT_PATH,
    lastMeteredAt: params.overrides?.lastMeteredAt ?? params.previousWorkspace?.lastMeteredAt,
    lastKnownStartedAt:
      params.overrides?.lastKnownStartedAt ??
      params.previousWorkspace?.lastKnownStartedAt,
    lastKnownStoppedAt:
      params.overrides?.lastKnownStoppedAt ??
      params.previousWorkspace?.lastKnownStoppedAt,
  })
}

async function applyWorkspaceConfiguration(params: {
  sandbox: Sandbox
  userId: string
  tier: DaytonaWorkspaceTier
}): Promise<DaytonaWorkspaceTier> {
  const desiredProfile = getDaytonaResourceProfile(params.tier)
  const desiredLabels = buildWorkspaceLabels(params.userId, params.tier)

  await params.sandbox.setLabels(desiredLabels)

  if (params.sandbox.autoStopInterval !== desiredProfile.autoStopMinutes) {
    await params.sandbox.setAutostopInterval(desiredProfile.autoStopMinutes)
  }
  if (params.sandbox.autoArchiveInterval !== desiredProfile.autoArchiveMinutes) {
    await params.sandbox.setAutoArchiveInterval(desiredProfile.autoArchiveMinutes)
  }
  if (params.sandbox.autoDeleteInterval !== -1) {
    await params.sandbox.setAutoDeleteInterval(-1)
  }

  const cpuDown = params.sandbox.cpu > desiredProfile.cpu
  const memoryDown = params.sandbox.memory > desiredProfile.memoryGiB
  const diskDown = params.sandbox.disk > desiredProfile.diskGiB
  const needsResize =
    params.sandbox.cpu !== desiredProfile.cpu ||
    params.sandbox.memory !== desiredProfile.memoryGiB ||
    params.sandbox.disk !== desiredProfile.diskGiB

  if (!needsResize) {
    await params.sandbox.refreshData()
    return resolveActualResourceProfile(params.sandbox, params.tier)
  }

  if (cpuDown || memoryDown || diskDown) {
    logger.warn(
      `[Daytona] Workspace ${params.sandbox.id} is larger than the ${params.tier} profile; ` +
      'skipping downsize during phases 1-2.',
    )
    await params.sandbox.refreshData()
    return resolveActualResourceProfile(params.sandbox, params.tier)
  }

  if (params.sandbox.state === 'started' && !canHotResizeUp(params.sandbox, desiredProfile)) {
    await params.sandbox.stop(60)
    await params.sandbox.refreshData()
  }

  const resources: Resources = {
    cpu: desiredProfile.cpu,
    memory: desiredProfile.memoryGiB,
    disk: desiredProfile.diskGiB,
  }
  try {
    await params.sandbox.resize(resources, 60)
  } catch (error) {
    if (!isSandboxResizeUnsupportedError(error)) {
      throw error
    }

    logger.warn(
      `[Daytona] Workspace ${params.sandbox.id} could not be resized via the current API; continuing with existing resources.`,
      error,
    )
  }
  await params.sandbox.refreshData()

  return resolveActualResourceProfile(params.sandbox, params.tier)
}

export function getDaytonaClient(): Daytona {
  if (daytonaClient) {
    return daytonaClient
  }

  const apiKey = process.env.DAYTONA_API_KEY?.trim()
  const apiUrl = process.env.DAYTONA_API_URL?.trim()

  if (!apiKey) {
    throw new Error('DAYTONA_API_KEY is not configured.')
  }

  if (!apiUrl) {
    throw new Error('DAYTONA_API_URL is not configured.')
  }

  daytonaClient = new Daytona({
    apiKey,
    apiUrl,
  })

  return daytonaClient
}

export function getWorkspaceSandboxName(userId: string): string {
  return sanitizeDaytonaName(`overlay-user-${userId}`)
}

export function getWorkspaceVolumeName(userId: string): string {
  return sanitizeDaytonaName(`overlay-user-${userId}-workspace`)
}

export async function createEphemeralSandbox(params: {
  runtime: DaytonaRuntime
  envVars?: Record<string, string>
  labels?: Record<string, string>
}): Promise<Sandbox> {
  return await getDaytonaClient().create(
    {
      language: getSandboxLanguage(params.runtime),
      envVars: params.envVars,
      labels: params.labels,
      ephemeral: true,
      autoStopInterval: 15,
      autoDeleteInterval: 0,
    },
    { timeout: 90 },
  )
}

export async function ensureVolume(userId: string): Promise<DaytonaVolumeRecord> {
  const volume = await getDaytonaClient().volume.get(getWorkspaceVolumeName(userId), true)
  return {
    id: volume.id,
    name: volume.name,
    state: volume.state,
  }
}

async function findExistingWorkspaceSandbox(userId: string): Promise<Sandbox | null> {
  const result = await getDaytonaClient().list(
    {
      overlay: 'true',
      'overlay.kind': 'workspace',
      'overlay.userId': userId,
    },
    1,
    100,
  )
  const sandboxName = getWorkspaceSandboxName(userId)
  const sandbox =
    result.items.find((candidate) => candidate.name === sandboxName) ??
    result.items.find((candidate) => candidate.name?.startsWith(sandboxName))

  if (!sandbox) {
    return null
  }

  await sandbox.refreshData()
  return sandbox
}

export async function ensureWorkspaceSandbox(params: {
  repository: DaytonaWorkspaceRepository
  userId: string
  tier: DaytonaWorkspaceTier
}): Promise<EnsuredDaytonaWorkspace> {
  const profile = getDaytonaResourceProfile(params.tier)
  const volume = await ensureVolume(params.userId)
  const existingWorkspace = await fetchWorkspaceByUserId(params.repository, params.userId)
  let sandbox: Sandbox | null = null

  if (existingWorkspace?.sandboxId) {
    try {
      sandbox = await getDaytonaClient().get(existingWorkspace.sandboxId)
      await sandbox.refreshData()
    } catch (error) {
      logger.warn(`[Daytona] Failed to load existing workspace sandbox ${existingWorkspace.sandboxId}:`, error)
      sandbox = null
    }
  }

  if (!sandbox) {
    sandbox = await findExistingWorkspaceSandbox(params.userId)
  }

  if (!sandbox) {
    const createParams = {
      name: getWorkspaceSandboxName(params.userId),
      language: CodeLanguage.JAVASCRIPT,
      labels: buildWorkspaceLabels(params.userId, params.tier),
      autoStopInterval: profile.autoStopMinutes,
      autoArchiveInterval: profile.autoArchiveMinutes,
      autoDeleteInterval: -1,
      volumes: [{ volumeId: volume.id, mountPath: WORKSPACE_MOUNT_PATH }] satisfies VolumeMount[],
    } satisfies CreateSandboxFromSnapshotParams

    try {
      sandbox = await getDaytonaClient().create(createParams, { timeout: 90 })
    } catch (error) {
      if (!isSandboxAlreadyExistsError(error)) {
        throw error
      }

      sandbox = await findExistingWorkspaceSandbox(params.userId)
      if (!sandbox) {
        throw error
      }
    }

    await sandbox.refreshData()
    await sandbox.setAutoDeleteInterval(-1)
    await sandbox.setAutostopInterval(profile.autoStopMinutes)
    await sandbox.setAutoArchiveInterval(profile.autoArchiveMinutes)
    await sandbox.refreshData()
  }

  const actualProfileId = await applyWorkspaceConfiguration({
    sandbox,
    userId: params.userId,
    tier: params.tier,
  })

  const workspace = await syncWorkspaceRecordFromSandbox({
    repository: params.repository,
    userId: params.userId,
    tier: params.tier,
    sandbox,
    volume,
    previousWorkspace: existingWorkspace,
  })

  return {
    workspace,
    sandbox,
    volume,
    profile: getDaytonaResourceProfile(actualProfileId),
    repository: params.repository,
  }
}

export async function startIfNeeded(input: EnsuredDaytonaWorkspace): Promise<EnsuredDaytonaWorkspace> {
  let overrides: Parameters<typeof syncWorkspaceRecordFromSandbox>[0]['overrides'] | undefined

  if (input.sandbox.state !== 'started') {
    await input.sandbox.start(60)
    await input.sandbox.refreshData()
    const now = Date.now()
    overrides = {
      state: 'started',
      lastKnownStartedAt: now,
      lastMeteredAt: now,
    }
  }

  const workspace = await syncWorkspaceRecordFromSandbox({
    repository: input.repository,
    userId: input.workspace.userId,
    tier: input.workspace.tier,
    sandbox: input.sandbox,
    volume: input.volume,
    previousWorkspace: input.workspace,
    overrides,
  })

  return {
    ...input,
    workspace,
    profile: getDaytonaResourceProfile(workspace.resourceProfile),
  }
}

export async function stopIfNeeded(input: EnsuredDaytonaWorkspace): Promise<EnsuredDaytonaWorkspace> {
  let overrides: Parameters<typeof syncWorkspaceRecordFromSandbox>[0]['overrides'] | undefined

  if (input.sandbox.state === 'started') {
    await input.sandbox.stop(60)
    await input.sandbox.refreshData()
    overrides = {
      state: normalizeSandboxState(input.sandbox.state),
      lastKnownStoppedAt: Date.now(),
    }
  }

  const workspace = await syncWorkspaceRecordFromSandbox({
    repository: input.repository,
    userId: input.workspace.userId,
    tier: input.workspace.tier,
    sandbox: input.sandbox,
    volume: input.volume,
    previousWorkspace: input.workspace,
    overrides,
  })

  return {
    ...input,
    workspace,
    profile: getDaytonaResourceProfile(workspace.resourceProfile),
  }
}

export async function archiveIfNeeded(input: EnsuredDaytonaWorkspace): Promise<EnsuredDaytonaWorkspace> {
  let current = input
  let overrides: Parameters<typeof syncWorkspaceRecordFromSandbox>[0]['overrides'] | undefined

  if (current.sandbox.state === 'started') {
    current = await stopIfNeeded(current)
  }

  if (current.sandbox.state !== 'archived') {
    await current.sandbox.archive()
    await current.sandbox.refreshData()
    overrides = {
      state: 'archived',
      lastKnownStoppedAt: Date.now(),
    }
  }

  const workspace = await syncWorkspaceRecordFromSandbox({
    repository: current.repository,
    userId: current.workspace.userId,
    tier: current.workspace.tier,
    sandbox: current.sandbox,
    volume: current.volume,
    previousWorkspace: current.workspace,
    overrides,
  })

  return {
    ...current,
    workspace,
    profile: getDaytonaResourceProfile(workspace.resourceProfile),
  }
}

export async function refreshWorkspaceActivity(input: EnsuredDaytonaWorkspace): Promise<void> {
  await input.sandbox.refreshActivity()
}

export async function accrueWorkspaceSpend(params: {
  repository: DaytonaWorkspaceRepository
  workspace: DaytonaWorkspaceRecord
  sandbox: Sandbox
  startedAt: number
  endedAt: number
  reason: DaytonaUsageReason
}): Promise<
  | { success: true; durationSeconds: number; costUsd: number; costCents: number }
  | { success: false; skipped: 'missing_workspace' | 'stale_meter_window' }
  | null
> {
  return await params.repository.accrueUsage({
      userId: params.workspace.userId,
      sandboxId: params.sandbox.id,
      tier: params.workspace.tier,
      resourceProfile: resolveActualResourceProfile(params.sandbox, params.workspace.resourceProfile),
      startedAt: params.startedAt,
      endedAt: params.endedAt,
      cpu: params.sandbox.cpu,
      memoryGiB: params.sandbox.memory,
      diskGiB: params.sandbox.disk,
      expectedLastMeteredAt: params.workspace.lastMeteredAt,
      reason: params.reason,
  })
}

export async function getSandboxPaths(sandbox: Sandbox): Promise<DaytonaPaths> {
  const workDir = trimTrailingSlash((await sandbox.getWorkDir()) || '/home/daytona')

  return {
    workDir,
    rootDir: WORKSPACE_ROOT_DIR,
    inputDir: WORKSPACE_INPUT_DIR,
    runDir: WORKSPACE_RUN_DIR,
    outputDir: WORKSPACE_OUTPUT_DIR,
    stdoutPath: pathPosix.join(WORKSPACE_OUTPUT_DIR, '.overlay-stdout.log'),
    stderrPath: pathPosix.join(WORKSPACE_OUTPUT_DIR, '.overlay-stderr.log'),
  }
}

export async function prepareSandboxWorkspace(
  sandbox: Sandbox,
  paths: DaytonaPaths,
): Promise<void> {
  await sandbox.process.executeCommand(
    [
      `mkdir -p ${shellQuote(paths.rootDir)}`,
      `mkdir -p ${shellQuote(paths.inputDir)}`,
      `mkdir -p ${shellQuote(paths.runDir)}`,
      `mkdir -p ${shellQuote(paths.outputDir)}`,
    ].join(' && '),
    paths.workDir,
    undefined,
    30,
  )
}

export async function uploadSandboxBuffer(
  sandbox: Sandbox,
  remotePath: string,
  contents: Buffer | string,
): Promise<void> {
  const data = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8')
  await sandbox.fs.uploadFile(data, remotePath, 60)
}

export async function executeSandboxCommand(
  sandbox: Sandbox,
  params: {
    command: string
    cwd: string
    env?: Record<string, string>
    stdoutPath: string
    stderrPath: string
  },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const commandPath = pathPosix.join(params.cwd, '.overlay-command.sh')
  const commandScript = `${params.command.trimEnd()}\n`

  await uploadSandboxBuffer(
    sandbox,
    commandPath,
    `#!/usr/bin/env bash\nset -o pipefail\n${commandScript}`,
  )

  const wrappedCommand =
    `mkdir -p ${shellQuote(pathPosix.dirname(params.stdoutPath))} && ` +
    `bash ${shellQuote(commandPath)} > ${shellQuote(params.stdoutPath)} 2> ${shellQuote(params.stderrPath)}; ` +
    'EXIT_CODE=$?; ' +
    `if [ -f ${shellQuote(params.stdoutPath)} ]; then cat ${shellQuote(params.stdoutPath)}; fi; ` +
    'exit $EXIT_CODE'

  const response = await sandbox.process.executeCommand(
    wrappedCommand,
    params.cwd,
    params.env,
    300,
  )

  let stderr = ''
  try {
    stderr = (await sandbox.fs.downloadFile(params.stderrPath, 60)).toString('utf8')
  } catch (_error) {
    stderr = ''
  }

  return {
    exitCode: response.exitCode,
    stdout: response.result || '',
    stderr,
  }
}

export async function downloadSandboxFile(
  sandbox: Sandbox,
  remotePath: string,
): Promise<Buffer> {
  return await sandbox.fs.downloadFile(remotePath, 60)
}

export async function deleteSandbox(sandbox: Sandbox | null | undefined): Promise<void> {
  if (!sandbox) return
  await sandbox.delete(60)
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
