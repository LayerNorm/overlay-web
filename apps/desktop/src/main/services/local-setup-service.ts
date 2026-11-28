import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, session } from 'electron'
import type {
  Input,
  LocalModelKeys,
  LocalModelProvider,
  LocalSetupApp,
  LocalSetupImportResult,
  LocalSetupScan
} from '@overlay/desktop-bridge'
import { instructionFacts, mcpAuth, resolveLocalSetupItem, scanLocalSetup, type ResolvedLocalSetupItem } from './local-setup'
import { privateThreadsService } from './private-threads-service'
import type { LocalMcpInput } from './local-mcp-servers'
import { getWebShellOrigin, WEB_SHELL_PARTITION } from './web-shell'
import { readLoginShellEnvironment } from './login-shell'

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
const IMPORT_TIMEOUT_MS = 20_000

/** Where other tools' settings are read from. Unpackaged builds may point QA at a fixture folder. */
function setupHome(): string {
  const override = app.isPackaged ? undefined : process.env.OVERLAY_DESKTOP_DEV_SETUP_HOME?.trim()
  return override || homedir()
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
type SaveLocalServer = (input: LocalMcpInput) => Promise<unknown>

/**
 * Adds one item to the workspace through Overlay's own API. Each request's idempotency key covers what it sends, so a
 * retry never duplicates and importing an edited file again is a new request.
 */
export async function importItem(
  item: ResolvedLocalSetupItem,
  workspaceId: string,
  defaults: Input<'localSetup.import'>['agentDefaults'],
  post: Post,
  saveLocalServer?: SaveLocalServer
): Promise<void> {
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
  if (item.kind === 'mcp_local') {
    // Stays on this computer: the list in the app's data folder, the environment values in the keychain.
    if (!saveLocalServer) throw new Error('This version of Overlay can’t run MCP servers on this computer yet.')
    await saveLocalServer({
      name: item.name, command: item.server.command, args: item.server.args, env: item.server.env,
      cwd: item.server.cwd ?? null, importedFrom: { itemId: item.id, app: item.app }
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

/** What one import sent, so importing the same contents into the same workspace again sends nothing. */
export function importDigest(item: ResolvedLocalSetupItem): string {
  return createHash('sha256').update(JSON.stringify(item)).digest('hex').slice(0, 32)
}

/**
 * `{ [workspaceId]: { [itemId]: digest } }` of items imported from this computer; local servers, which stay on this
 * computer whatever the workspace, are under `LOCAL_SERVERS`.
 */
type ImportLedger = Record<string, Record<string, string>>
const LOCAL_SERVERS = '@this-computer'

/**
 * Marks items already in the workspace with the same contents (and local servers already on this computer with the
 * same configuration), so a second import leaves them out. Edited files and changed servers are offered again.
 */
export function markImported(
  apps: LocalSetupApp[],
  ledger: Record<string, string>,
  resolve: (id: string) => ResolvedLocalSetupItem | null,
  localServers: ReadonlyMap<string, string>
): LocalSetupApp[] {
  return apps.map((entry) => ({
    ...entry,
    items: entry.items.map((item) => {
      const digest = item.kind === 'mcp_local' ? localServers.get(item.id) : ledger[item.id]
      const resolved = digest ? resolve(item.id) : null
      return resolved && importDigest(resolved) === digest ? { ...item, imported: true } : item
    })
  }))
}

const ledgerPath = () => join(app.getPath('userData'), 'local-setup-imports.json')

function readLedger(): ImportLedger {
  try {
    const value = JSON.parse(readFileSync(ledgerPath(), 'utf8')) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as ImportLedger : {}
  } catch {
    return {}
  }
}

function writeLedger(ledger: ImportLedger): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(ledgerPath(), `${JSON.stringify(ledger)}\n`, { mode: 0o600 })
  } catch { /* Without the record, the server's idempotency keys still cover a retry within a day. */ }
}

class LocalSetupService {
  private shellKeys: Map<LocalModelProvider, string> | null = null

  async scan(input?: Input<'localSetup.scan'>): Promise<LocalSetupScan> {
    const home = setupHome()
    const keys = shellKeysFrom(await readLoginShellEnvironment(home))
    this.shellKeys = new Map(keys.map(({ provider, value }) => [provider, value]))
    const localMcp = privateThreadsService.supportsLocalMcp()
    const found = scanLocalSetup(home, process.platform, { localMcp })
    const apps = input?.workspaceId
      ? markImported(found, readLedger()[input.workspaceId] ?? {}, (id) => resolveLocalSetupItem(home, id), this.localServerDigests(localMcp))
      : found
    return {
      apps,
      shellKeys: keys.map(({ provider, variable, value }) => ({ provider, variable, hint: value.slice(-4) })),
      subscriptions: subscriptionSignIns(home)
    }
  }

  async import(input: Input<'localSetup.import'>): Promise<LocalSetupImportResult> {
    const home = setupHome()
    const result: LocalSetupImportResult = { imported: [], failed: [] }
    const saveLocalServer = privateThreadsService.supportsLocalMcp()
      ? (server: LocalMcpInput) => privateThreadsService.mcpSave(server)
      : undefined
    for (const id of new Set(input.itemIds)) {
      const item = resolveLocalSetupItem(home, id)
      if (!item) {
        result.failed.push({ id, name: id.split(':').at(-1) ?? id, error: 'It is no longer on this computer, or it can’t be imported.' })
        continue
      }
      const ledger = readLedger()
      const digest = importDigest(item)
      try {
        // The same contents were already imported into this workspace: nothing to send. Local servers update in place.
        if (item.kind === 'mcp_local' || ledger[input.workspaceId]?.[id] !== digest) {
          await importItem(item, input.workspaceId, input.agentDefaults, postWithAppSession, saveLocalServer)
          const bucket = item.kind === 'mcp_local' ? LOCAL_SERVERS : input.workspaceId
          writeLedger({ ...ledger, [bucket]: { ...ledger[bucket], [id]: digest } })
        }
        result.imported.push({ id, kind: item.kind, name: item.name })
      } catch (error) {
        result.failed.push({ id, name: item.name, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return result
  }

  /** Imported local servers still on this computer, with the digest of the configuration they were imported with. */
  private localServerDigests(supported: boolean): Map<string, string> {
    if (!supported) return new Map()
    const recorded = readLedger()[LOCAL_SERVERS] ?? {}
    return new Map(privateThreadsService.mcpImportedItemIds().flatMap((id) => recorded[id] ? [[id, recorded[id]] as const] : []))
  }

  async useShellKey(input: Input<'localSetup.useShellKey'>): Promise<LocalModelKeys> {
    if (!this.shellKeys) await this.scan()
    const apiKey = this.shellKeys?.get(input.provider)
    if (!apiKey) throw new Error('That key is no longer set in your shell.')
    return await privateThreadsService.setKey({ provider: input.provider, apiKey })
  }
}

export const localSetupService = new LocalSetupService()
