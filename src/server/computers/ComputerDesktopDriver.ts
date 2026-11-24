import 'server-only'

import {
  COMPUTER_DRIVER_SOURCE,
  DRIVER_VERSION,
  type SandboxCommandResult,
  type SandboxInstance,
} from '@overlay/sandbox-runtime'
import { logger } from '@/server/observability/logger'
import type { LocalDriverCommand } from '@layernorm/overlay-agent-bridge-protocol'
import { LocalComputerError } from './local/LocalComputerService'
import { isLocalHostSandboxInstance, type LocalHostSandboxInstance } from './local/LocalHostSandboxInstance'

const DRIVER_PATH = `/tmp/overlay-computer/driver-${DRIVER_VERSION}.py`
const SCREENSHOT_PATH = '/tmp/overlay-computer/shot.png'
const PREPARE_TIMEOUT_MS = 60_000
const DRIVER_CHECK_TIMEOUT_MS = 10_000
const DRIVER_ACTION_TIMEOUT_MS = 30_000
const PREPARE_MARKER = `/tmp/overlay-computer/prepare-attempted-${DRIVER_VERSION}`
const PREPARE_COMMAND = [
  'set -eu',
  'mkdir -p /tmp/overlay-computer',
  `marker=${PREPARE_MARKER}`,
  '[ -f "$marker" ] && exit 0',
  '(set -C; : > "$marker") 2>/dev/null || exit 0',
  'command -v apt-get >/dev/null 2>&1',
  'command -v sudo >/dev/null 2>&1',
  'timeout 55s sudo -n apt-get install -y xdotool imagemagick chromium',
].join('\n')

type DriverCapabilities = {
  version: string
  display: string
  screen: { width: number; height: number }
  input: boolean
  screenshot: boolean
  missing: string[]
}

export class ComputerDesktopDriverError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly missing: string[] = [],
    readonly detail?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ComputerDesktopDriverError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function capabilitiesFrom(value: unknown): DriverCapabilities | null {
  if (
    !isRecord(value)
    || value.version !== DRIVER_VERSION
    || typeof value.display !== 'string'
    || !isRecord(value.screen)
    || typeof value.screen.width !== 'number'
    || typeof value.screen.height !== 'number'
    || typeof value.input !== 'boolean'
    || typeof value.screenshot !== 'boolean'
    || !Array.isArray(value.missing)
  ) return null
  return value as unknown as DriverCapabilities
}

async function runDriverProcess(
  instance: SandboxInstance,
  request: Record<string, unknown>,
  timeoutMs: number,
  environment?: Record<string, string>,
): Promise<SandboxCommandResult> {
  const handle = await instance.runCommand({
    command: 'sh',
    args: [
      '-c',
      'mkdir -p /tmp/overlay-computer && exec python3 "$@"',
      'overlay-computer',
      DRIVER_PATH,
      JSON.stringify(request),
    ],
    environment,
    timeoutMs,
  })
  return await handle.wait()
}

async function runCommand(
  instance: SandboxInstance,
  request: Record<string, unknown>,
  timeoutMs: number,
  environment?: Record<string, string>,
): Promise<SandboxCommandResult | null> {
  try {
    return await runDriverProcess(instance, request, timeoutMs, environment)
  } catch (_error) {
    return null
  }
}

/** Why the driver's capabilities check failed, kept so the error names the real cause instead of guessing. */
type DriverProbeFailure = {
  stage: 'start' | 'exit' | 'output'
  exitCode?: number
  stdout?: string
  stderr?: string
  error?: string
}

type DriverProbe =
  | { ok: true; capabilities: DriverCapabilities }
  | { ok: false; failure: DriverProbeFailure }

const PROBE_OUTPUT_LIMIT = 1_000

function outputTail(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length > PROBE_OUTPUT_LIMIT ? `…${trimmed.slice(-PROBE_OUTPUT_LIMIT)}` : trimmed
}

async function probe(instance: SandboxInstance): Promise<DriverProbe> {
  let result: SandboxCommandResult
  try {
    result = await runDriverProcess(instance, { command: 'capabilities' }, DRIVER_CHECK_TIMEOUT_MS)
  } catch (error) {
    return {
      ok: false,
      failure: { stage: 'start', error: outputTail(error instanceof Error ? error.message : String(error)) },
    }
  }
  let capabilities: DriverCapabilities | null = null
  try {
    capabilities = capabilitiesFrom(JSON.parse(result.stdout))
  } catch (_error) {
    capabilities = null
  }
  if (result.exitCode === 0 && capabilities) return { ok: true, capabilities }
  return {
    ok: false,
    failure: {
      stage: result.exitCode === 0 ? 'output' : 'exit',
      exitCode: result.exitCode,
      stdout: outputTail(result.stdout),
      stderr: outputTail(result.stderr),
    },
  }
}

function lastLine(value: string | undefined): string | undefined {
  return value?.split('\n').map((line) => line.trim()).filter(Boolean).at(-1)
}

function probeFailureError(failure: DriverProbeFailure): ComputerDesktopDriverError {
  const detail = { ...failure }
  if (failure.exitCode === 127 && /python3/.test(failure.stderr ?? '')) {
    return new ComputerDesktopDriverError(
      'desktop_unsupported',
      'Python 3 is required to run the desktop driver.',
      ['python3'],
      detail,
    )
  }
  const reason = failure.stage === 'start'
    ? `the check command could not run${failure.error ? ` (${failure.error})` : ''}`
    : failure.exitCode === 124
      ? 'the check timed out'
      : failure.stage === 'exit'
        ? `the check exited with code ${failure.exitCode}${lastLine(failure.stderr) ? `: ${lastLine(failure.stderr)}` : ''}`
        : 'the check returned unexpected output'
  return new ComputerDesktopDriverError(
    'desktop_driver_failed',
    `The desktop driver did not start: ${reason}.`,
    [],
    detail,
  )
}

async function prepareMissingTools(instance: SandboxInstance): Promise<boolean> {
  try {
    const handle = await instance.runCommand({
      command: 'sh',
      args: ['-c', PREPARE_COMMAND],
      timeoutMs: PREPARE_TIMEOUT_MS,
    })
    const result = await handle.wait()
    return result.exitCode === 0
  } catch (_error) {
    return false
  }
}

function missingTools(capabilities: DriverCapabilities): string[] {
  return [...new Set([
    ...capabilities.missing,
    ...(!capabilities.input ? ['xdotool'] : []),
    ...(!capabilities.screenshot ? ['imagemagick'] : []),
  ])]
}

export async function ensureDriver(
  instance: SandboxInstance,
  requireDesktop = true,
): Promise<DriverCapabilities> {
  if (requireDesktop && !instance.capabilities.desktop) {
    throw new ComputerDesktopDriverError(
      'desktop_unsupported',
      'This computer does not have a desktop.',
    )
  }

  let probed = await probe(instance)
  if (!probed.ok) {
    try {
      await instance.writeFiles([{
        path: DRIVER_PATH,
        contents: new TextEncoder().encode(COMPUTER_DRIVER_SOURCE),
        mode: 0o700,
      }])
    } catch (error) {
      throw new ComputerDesktopDriverError(
        'desktop_driver_failed',
        'The desktop driver could not be installed.',
        [],
        { error: outputTail(error instanceof Error ? error.message : String(error)) },
      )
    }
    probed = await probe(instance)
  }
  if (!probed.ok) {
    logger.warn('[computer-driver] capabilities check failed', {
      provider: instance.provider,
      reference: instance.reference,
      stage: probed.failure.stage,
      exitCode: probed.failure.exitCode,
    })
    throw probeFailureError(probed.failure)
  }
  let capabilities = probed.capabilities

  if (requireDesktop && missingTools(capabilities).length > 0) {
    if (!await prepareMissingTools(instance)) {
      const missing = missingTools(capabilities)
      throw new ComputerDesktopDriverError(
        'desktop_unsupported',
        `Desktop control requires: ${missing.join(', ')}.`,
        missing,
      )
    }
    const reprobed = await probe(instance)
    if (reprobed.ok) capabilities = reprobed.capabilities
  }
  const missing = requireDesktop ? missingTools(capabilities) : []
  if (missing.length > 0) {
    throw new ComputerDesktopDriverError(
      'desktop_unsupported',
      `Desktop control requires: ${missing.join(', ')}.`,
      missing,
    )
  }
  return capabilities
}

function responseFromResult(result: SandboxCommandResult | null): Record<string, unknown> {
  if (!result) {
    throw new ComputerDesktopDriverError('desktop_driver_failed', 'The desktop command failed.')
  }

  let response: unknown
  try {
    response = JSON.parse(result.stdout)
  } catch (_error) {
    throw new ComputerDesktopDriverError('desktop_driver_failed', 'The desktop driver returned invalid output.')
  }
  if (isRecord(response) && isRecord(response.error)) {
    const error = response.error
    throw new ComputerDesktopDriverError(
      typeof error.code === 'string' ? error.code : 'desktop_driver_failed',
      typeof error.message === 'string' ? error.message : 'The desktop command failed.',
      Array.isArray(error.missing) ? error.missing.filter((value): value is string => typeof value === 'string') : [],
      isRecord(error.detail) ? error.detail : undefined,
    )
  }
  if (result.exitCode !== 0 || !isRecord(response)) {
    throw new ComputerDesktopDriverError('desktop_driver_failed', 'The desktop command failed.')
  }
  return response
}

export async function runComputerDriverCommand(
  instance: SandboxInstance,
  command: string,
  args: Record<string, unknown> = {},
  options: {
    requireDesktop?: boolean
    environment?: Record<string, string>
    /** Overrides the default 30s command limit for commands that are known to run longer. */
    timeoutMs?: number
  } = {},
): Promise<Record<string, unknown>> {
  if (isLocalHostSandboxInstance(instance)) return await runLocalDriverCommand(instance, command, args)
  const requireDesktop = options.requireDesktop !== false
  const timeoutMs = options.timeoutMs ?? DRIVER_ACTION_TIMEOUT_MS
  await ensureDriver(instance, requireDesktop)
  const request = command === 'terminal_start'
    ? { ...args, terminalCommand: args.command, command }
    : { ...args, command }
  let result = await runCommand(instance, request, timeoutMs, options.environment)
  let response: Record<string, unknown>
  try {
    response = responseFromResult(result)
  } catch (error) {
    const missingChromium = error instanceof ComputerDesktopDriverError
      && error.code === 'desktop_unsupported'
      && error.missing.includes('chromium')
    if (
      command !== 'browser_ensure'
      || !requireDesktop
      || !missingChromium
      || !await prepareMissingTools(instance)
    ) {
      throw error
    }
    result = await runCommand(instance, request, timeoutMs, options.environment)
    response = responseFromResult(result)
  }

  if (command === 'screenshot') {
    let image: Uint8Array | null
    try {
      image = await instance.readFile(SCREENSHOT_PATH)
    } catch (_error) {
      image = null
    }
    if (!image) {
      throw new ComputerDesktopDriverError('desktop_driver_failed', 'The screenshot file could not be read.')
    }
    return { ...response, image }
  }
  return response
}

/** The user's own computer runs the same commands through its host's native driver; no Python driver is installed. */
async function runLocalDriverCommand(
  instance: LocalHostSandboxInstance,
  command: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let response: Record<string, unknown>
  try {
    response = await instance.driver(command as LocalDriverCommand, args)
  } catch (error) {
    if (error instanceof LocalComputerError) throw new ComputerDesktopDriverError(error.code, error.message, error.missing, error.detail)
    throw error
  }
  if (command !== 'screenshot') return response
  const { imageBase64, ...rest } = response
  if (typeof imageBase64 !== 'string') throw new ComputerDesktopDriverError('desktop_driver_failed', 'The screenshot could not be read.')
  return { ...rest, image: new Uint8Array(Buffer.from(imageBase64, 'base64')) }
}

export async function run(
  instance: SandboxInstance,
  command: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return await runComputerDriverCommand(instance, command, args)
}

export async function openUrl(
  instance: SandboxInstance,
  url: string,
): Promise<{ openedWith: 'browser' | 'xdg-open' | 'default_browser' }> {
  if (isLocalHostSandboxInstance(instance)) {
    const result = await runLocalDriverCommand(instance, 'open_url', { url })
    return { openedWith: result.openedWith === 'default_browser' ? 'default_browser' : 'browser' }
  }
  if (!instance.capabilities.desktop) {
    throw new ComputerDesktopDriverError('desktop_unsupported', 'This computer does not have a desktop.')
  }
  try {
    if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('invalid protocol')
  } catch (_error) {
    throw new ComputerDesktopDriverError('invalid_input', 'url must be an HTTP or HTTPS URL.')
  }

  try {
    await run(instance, 'browser_ensure')
  } catch (error) {
    if (
      !(error instanceof ComputerDesktopDriverError)
      || error.code !== 'desktop_unsupported'
      || !error.missing.includes('chromium')
    ) {
      throw error
    }
    const handle = await instance.runCommand({
      command: 'xdg-open',
      args: [url],
      environment: { DISPLAY: ':0' },
      timeoutMs: 15_000,
    })
    const result = await handle.wait()
    if (result.exitCode !== 0) {
      throw new ComputerDesktopDriverError(
        'desktop_driver_failed',
        `xdg-open failed (exit ${result.exitCode}): ${result.stderr.trim() || result.stdout.trim() || 'no output'}`,
      )
    }
    return { openedWith: 'xdg-open' }
  }

  await run(instance, 'browser', { action: 'navigate', url })
  return { openedWith: 'browser' }
}

function browserActionText(
  action: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
): string {
  if (action === 'snapshot') {
    const elements = Array.isArray(result.elements) ? result.elements.filter(isRecord) : []
    const lines = elements.map((element) => {
      const bbox = isRecord(element.bbox) ? element.bbox : {}
      return [
        `${String(element.ref ?? '')} ${String(element.role ?? '')}: ${String(element.name ?? '')}`,
        `  bbox x=${String(bbox.x ?? 0)} y=${String(bbox.y ?? 0)} width=${String(bbox.width ?? 0)} height=${String(bbox.height ?? 0)}`,
      ].join('\n')
    })
    return [
      `URL: ${String(result.url ?? '')}`,
      `Title: ${String(result.title ?? '')}`,
      'Visible text:',
      String(result.text ?? '').slice(0, 20_000),
      `Interactive elements (${elements.length}):`,
      ...lines,
    ].join('\n')
  }
  if (action === 'tabs') {
    const tabs = Array.isArray(result.tabs) ? result.tabs.filter(isRecord) : []
    return [
      `Open tabs (${tabs.length}):`,
      ...tabs.map((tab) => `${String(tab.index ?? '')}: ${String(tab.title ?? '')} ${String(tab.url ?? '')}`),
    ].join('\n')
  }
  if (action === 'navigate') return `Navigated to ${String(args.url ?? 'the requested URL')}.`
  if (action === 'switch_tab') return `Switched to browser tab ${String(result.index ?? args.index ?? '')}.`
  if (action === 'new_tab') return 'Opened a new browser tab.'
  return `Browser ${action.replaceAll('_', ' ')} completed.`
}

export async function runBrowserAction(
  instance: SandboxInstance,
  action: string,
  args: Record<string, unknown> = {},
): Promise<{ result: Record<string, unknown>; text: string }> {
  await run(instance, 'browser_ensure')
  const result = await run(instance, 'browser', { ...args, action })
  return { result, text: browserActionText(action, args, result) }
}
