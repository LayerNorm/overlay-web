import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, session } from 'electron'
import type {
  Input,
  LocalModelKeys,
  LocalModelProvider,
  LocalSetupImportResult,
  LocalSetupScan
} from '@overlay/desktop-bridge'
import { instructionFacts, mcpAuth, resolveLocalSetupItem, scanLocalSetup, type ResolvedLocalSetupItem } from './local-setup'
import { privateThreadsService } from './private-threads-service'
import { getWebShellOrigin, WEB_SHELL_PARTITION } from './web-shell'

/**
 * First-run setup on this computer: what other AI tools keep here, model keys in the login shell, and importing
 * the chosen items into the workspace. The page sees names, counts and the last four characters of a key; contents,
 * header tokens and keys go from here straight to Overlay or the system keychain.
 */

const SHELL_KEY_VARIABLES: Array<{ provider: LocalModelProvider; variables: string[] }> = [
  { provider: 'anthropic', variables: ['ANTHROPIC_API_KEY'] },
  { provider: 'openai', variables: ['OPENAI_API_KEY'] },
  { provider: 'google', variables: ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'] },
  { provider: 'openrouter', variables: ['OPENROUTER_API_KEY'] }
]
const SHELL_TIMEOUT_MS = 5_000
const IMPORT_TIMEOUT_MS = 20_000
const ENV_MARKER = '__OVERLAY_ENV__'

/** Where other tools' settings are read from. Unpackaged builds may point QA at a fixture folder. */
function setupHome(): string {
  const override = app.isPackaged ? undefined : process.env.OVERLAY_DESKTOP_DEV_SETUP_HOME?.trim()
  return override || homedir()
}

/** The login shell's environment, where people keep model keys; the app itself starts without it on macOS. */
export function readLoginShellEnvironment(home = homedir()): Promise<Record<string, string>> {
  const shell = process.env.SHELL || '/bin/zsh'
  return new Promise((resolve) => {
    execFile(shell, ['-ilc', `printf '${ENV_MARKER}'; env -0`], { timeout: SHELL_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, HOME: home } }, (_error, stdout) => {
      const text = String(stdout ?? '')
      const start = text.indexOf(ENV_MARKER)
      if (start < 0) return resolve({})
      const pairs = text.slice(start + ENV_MARKER.length).split('\0')
      resolve(Object.fromEntries(pairs.flatMap((pair) => {
        const index = pair.indexOf('=')
        return index > 0 ? [[pair.slice(0, index), pair.slice(index + 1)]] : []
      })))
    })
  })
}

export function shellKeysFrom(environment: Record<string, string>): Array<{ provider: LocalModelProvider; variable: string; value: string }> {
  return SHELL_KEY_VARIABLES.flatMap(({ provider, variables }) => {
    const variable = variables.find((name) => (environment[name] ?? '').trim().length >= 8)
    return variable ? [{ provider, variable, value: environment[variable]!.trim() }] : []
  })
}

/** Whether Claude Code and Codex are signed in with a plan (not an API key): a hint to sign in to that plan for private threads. */
export function subscriptionSignIns(home: string): LocalSetupScan['subscriptions'] {
  const json = (path: string): Record<string, unknown> | null => {
    try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> : null } catch { return null }
  }
  const claude = json(join(home, '.claude.json'))
  const codex = json(join(home, '.codex/auth.json'))
  return { claude: Boolean(claude?.oauthAccount), chatgpt: Boolean(codex?.tokens) }
}

type Post = (path: string, workspaceId: string, idempotencyKey: string, body: unknown) => Promise<void>

/**
 * Adds one item to the workspace through Overlay's own API. Each request's idempotency key covers what it sends, so a
 * retry never duplicates and importing an edited file again is a new request.
 */
export async function importItem(item: ResolvedLocalSetupItem, workspaceId: string, defaults: Input<'localSetup.import'>['agentDefaults'], post: Post): Promise<void> {
  const send = (path: string, body: unknown) => {
    const digest = createHash('sha256').update(`${workspaceId}\0${path}\0${JSON.stringify(body)}`).digest('hex').slice(0, 40)
    return post(path, workspaceId, `desktop-setup:${digest}`, body)
  }
  if (item.kind === 'instructions') {
    const facts = instructionFacts(item.content)
    if (!facts.length) throw new Error('No instructions found to remember.')
    for (const content of facts) await send('/api/v1/memory', { content, source: 'manual', tags: ['imported'] })
    return
  }
  if (item.kind === 'skill') {
    await send('/api/v1/skills', { name: item.name, description: item.description, instructions: item.instructions, scope: 'personal' })
    return
  }
  if (item.kind === 'agent') {
    await send('/api/v1/agents', {
      name: item.name, description: item.description, instructions: item.instructions,
      harness: 'overlay', modelId: defaults.modelId, allowedToolIds: defaults.allowedToolIds, visibility: 'creator'
    })
    return
  }
  await send('/api/v1/mcps', {
    name: item.server.name, transport: item.server.transport, url: item.server.url, scope: 'personal', ...mcpAuth(item.server.headers)
  })
}

async function postWithAppSession(path: string, workspaceId: string, idempotencyKey: string, body: unknown): Promise<void> {
  const origin = getWebShellOrigin()
  const response = await session.fromPartition(WEB_SHELL_PARTITION).fetch(`${origin}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      'x-overlay-workspace-id': workspaceId,
      Referer: `${origin}/app`
    },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(IMPORT_TIMEOUT_MS)
  })
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as { error?: unknown; message?: unknown } | null
    const message = typeof failure?.error === 'string' ? failure.error : typeof failure?.message === 'string' ? failure.message : null
    throw new Error(message ?? `Overlay answered ${response.status}.`)
  }
}

class LocalSetupService {
  private shellKeys: Map<LocalModelProvider, string> | null = null

  async scan(): Promise<LocalSetupScan> {
    const home = setupHome()
    const keys = shellKeysFrom(await readLoginShellEnvironment(home))
    this.shellKeys = new Map(keys.map(({ provider, value }) => [provider, value]))
    return {
      apps: scanLocalSetup(home),
      shellKeys: keys.map(({ provider, variable, value }) => ({ provider, variable, hint: value.slice(-4) })),
      subscriptions: subscriptionSignIns(home)
    }
  }

  async import(input: Input<'localSetup.import'>): Promise<LocalSetupImportResult> {
    const home = setupHome()
    const result: LocalSetupImportResult = { imported: [], failed: [] }
    for (const id of new Set(input.itemIds)) {
      const item = resolveLocalSetupItem(home, id)
      if (!item) {
        result.failed.push({ id, name: id.split(':').at(-1) ?? id, error: 'It is no longer on this computer, or it can’t be imported.' })
        continue
      }
      try {
        await importItem(item, input.workspaceId, input.agentDefaults, postWithAppSession)
        result.imported.push({ id, kind: item.kind, name: item.name })
      } catch (error) {
        result.failed.push({ id, name: item.name, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return result
  }

  async useShellKey(input: Input<'localSetup.useShellKey'>): Promise<LocalModelKeys> {
    if (!this.shellKeys) await this.scan()
    const apiKey = this.shellKeys?.get(input.provider)
    if (!apiKey) throw new Error('That key is no longer set in your shell.')
    return await privateThreadsService.setKey({ provider: input.provider, apiKey })
  }
}

export const localSetupService = new LocalSetupService()
