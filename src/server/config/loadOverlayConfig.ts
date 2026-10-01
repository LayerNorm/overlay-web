import 'server-only'

import { existsSync, readFileSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { ZodError } from 'zod'
import {
  mergeOverlayRuntimeConfig,
  parseOverlayRuntimeConfig,
  redactOverlayRuntimeConfig,
  type OverlayRuntimeConfig,
  type OverlayRuntimeConfigInput,
  type OverlayRuntimeConfigPublicSummary,
} from '../../shared/config'
import { overlayRuntimeConfigDefaults } from '../../overlay.config'
import { configOverridesFromEnv } from './env-overrides'

export { configOverridesFromEnv } from './env-overrides'

type EnvSource = Record<string, string | undefined>
type OverlayRuntimeConfigLayer = Record<string, unknown>

export interface LoadOverlayConfigOptions {
  env?: EnvSource
  cwd?: string
  defaultConfig?: OverlayRuntimeConfigInput
  configFilePath?: string | null
  remoteConfigUrl?: string | null
  fetcher?: typeof fetch
}

export class OverlayConfigError extends Error {
  readonly issues: string[]

  constructor(message: string, issues: string[]) {
    super(message)
    this.name = 'OverlayConfigError'
    this.issues = issues
  }
}

let cachedRuntimeConfig: OverlayRuntimeConfig | null = null

export async function loadOverlayConfig(
  options: LoadOverlayConfigOptions = {},
): Promise<OverlayRuntimeConfig> {
  const env = options.env ?? process.env
  const defaultConfig = options.defaultConfig ?? overlayRuntimeConfigDefaults
  const [fileConfig, remoteConfig] = await Promise.all([
    readJsonConfigFile(resolveConfigFilePath(options, env), options.cwd),
    readRemoteConfig(resolveRemoteConfigUrl(options, env), options.fetcher),
  ])
  const envConfig = configOverridesFromEnvOrThrow(env)

  return parseConfigOrThrow(
    mergeOverlayRuntimeConfig(defaultConfig, fileConfig, remoteConfig, envConfig),
  )
}

export function loadOverlayConfigSync(
  options: Omit<LoadOverlayConfigOptions, 'fetcher' | 'remoteConfigUrl'> = {},
): OverlayRuntimeConfig {
  const env = options.env ?? process.env
  const defaultConfig = options.defaultConfig ?? overlayRuntimeConfigDefaults
  const remoteUrl = readEnv(env, 'OVERLAY_CONFIG_URL')
  if (remoteUrl) {
    throw new OverlayConfigError('Remote runtime config requires async loadOverlayConfig()', [
      'OVERLAY_CONFIG_URL is set but loadOverlayConfigSync() cannot fetch remote config.',
    ])
  }

  const fileConfig = readJsonConfigFileSync(resolveConfigFilePath(options, env), options.cwd)
  const envConfig = configOverridesFromEnvOrThrow(env)
  return parseConfigOrThrow(mergeOverlayRuntimeConfig(defaultConfig, fileConfig, envConfig))
}

export async function getOverlayRuntimeConfig(): Promise<OverlayRuntimeConfig> {
  cachedRuntimeConfig ??= await loadOverlayConfig()
  return cachedRuntimeConfig
}

export function getOverlayRuntimeConfigSync(): OverlayRuntimeConfig {
  cachedRuntimeConfig ??= loadOverlayConfigSync()
  return cachedRuntimeConfig
}

export function clearOverlayRuntimeConfigCache(): void {
  cachedRuntimeConfig = null
}

export function getRedactedOverlayRuntimeConfigSummary(
  config: OverlayRuntimeConfig,
): OverlayRuntimeConfigPublicSummary {
  return redactOverlayRuntimeConfig(config)
}

export function formatOverlayConfigError(error: unknown): { message: string; issues: string[] } {
  if (error instanceof OverlayConfigError) {
    return { message: error.message, issues: error.issues }
  }
  if (error instanceof ZodError) {
    return {
      message: 'Overlay runtime configuration is invalid',
      issues: error.issues.map((issue) => {
        const pathLabel = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
        return `${pathLabel}${issue.message}`
      }),
    }
  }
  if (error instanceof Error) {
    return { message: error.message, issues: [error.message] }
  }
  return { message: 'Overlay runtime configuration is invalid', issues: [String(error)] }
}

export function isOverlayConfigError(error: unknown): error is OverlayConfigError {
  if (error instanceof OverlayConfigError) return true
  if (!(error instanceof Error) || error.name !== 'OverlayConfigError') return false
  const candidate = error as Error & { issues?: unknown }
  return Array.isArray(candidate.issues) && candidate.issues.every((issue) => typeof issue === 'string')
}

function parseConfigOrThrow(value: unknown): OverlayRuntimeConfig {
  try {
    return parseOverlayRuntimeConfig(value)
  } catch (error) {
    const formatted = formatOverlayConfigError(error)
    throw new OverlayConfigError(formatted.message, formatted.issues)
  }
}

function configOverridesFromEnvOrThrow(env: EnvSource): OverlayRuntimeConfigLayer {
  try {
    return configOverridesFromEnv(env)
  } catch (error) {
    if (error instanceof OverlayConfigError) throw error
    const formatted = formatOverlayConfigError(error)
    throw new OverlayConfigError(formatted.message, formatted.issues)
  }
}

function resolveConfigFilePath(
  options: Pick<LoadOverlayConfigOptions, 'configFilePath'>,
  env: EnvSource,
): string | null {
  if (options.configFilePath !== undefined) return options.configFilePath
  return readEnv(env, 'OVERLAY_CONFIG_FILE') ?? 'overlay.config.json'
}

function resolveRemoteConfigUrl(
  options: Pick<LoadOverlayConfigOptions, 'remoteConfigUrl'>,
  env: EnvSource,
): string | null {
  if (options.remoteConfigUrl !== undefined) return options.remoteConfigUrl
  return readEnv(env, 'OVERLAY_CONFIG_URL') ?? null
}

async function readJsonConfigFile(
  filePath: string | null,
  cwd = process.cwd(),
): Promise<OverlayRuntimeConfigLayer> {
  if (!filePath) return {}
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath)
  try {
    await access(absolutePath)
  } catch (_error) {
    if (filePath === 'overlay.config.json') return {}
    throw new OverlayConfigError('Overlay config file not found', [`Missing ${absolutePath}`])
  }

  return parseJsonObject(await readFile(absolutePath, 'utf8'), absolutePath)
}

function readJsonConfigFileSync(
  filePath: string | null,
  cwd = process.cwd(),
): OverlayRuntimeConfigLayer {
  if (!filePath) return {}
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath)
  if (!existsSync(absolutePath)) {
    if (filePath === 'overlay.config.json') return {}
    throw new OverlayConfigError('Overlay config file not found', [`Missing ${absolutePath}`])
  }

  return parseJsonObject(readFileSync(absolutePath, 'utf8'), absolutePath)
}

async function readRemoteConfig(
  remoteConfigUrl: string | null,
  fetcher: typeof fetch = fetch,
): Promise<OverlayRuntimeConfigLayer> {
  if (!remoteConfigUrl) return {}
  const response = await fetcher(remoteConfigUrl, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new OverlayConfigError('Remote overlay config fetch failed', [
      `${remoteConfigUrl} returned HTTP ${response.status}`,
    ])
  }
  const json = await response.json()
  return assertPlainConfigObject(json, remoteConfigUrl)
}

function parseJsonObject(raw: string, source: string): OverlayRuntimeConfigLayer {
  try {
    return assertPlainConfigObject(JSON.parse(raw), source)
  } catch (error) {
    if (error instanceof OverlayConfigError) throw error
    throw new OverlayConfigError('Overlay config JSON is invalid', [
      `${source}: ${error instanceof Error ? error.message : String(error)}`,
    ])
  }
}

function assertPlainConfigObject(
  value: unknown,
  source: string,
): OverlayRuntimeConfigLayer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OverlayConfigError('Overlay config must be a JSON object', [source])
  }
  return value as OverlayRuntimeConfigLayer
}

function readEnv(env: EnvSource, name: string): string | undefined {
  const value = env[name]?.trim()
  return value ? value : undefined
}
