import { lstat, readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  AGENT_PROFILE_LIMITS,
  analyzeAgentProfile,
  summarizeAgentProfile,
  type AgentProfileFile,
  type AgentProfileHarness,
  type AgentProfileUpload,
  type AnalyzedProfile,
} from '@layernorm/overlay-agent-bridge-protocol'

/** Folders and files read from each harness's config folder. Everything else is never opened. */
const COLLECT: Record<AgentProfileHarness, { folder: string; files: string[]; dirs: string[]; extra?: { from: string; as: string } }> = {
  'claude-code': {
    folder: '.claude',
    files: ['CLAUDE.md', 'settings.json'],
    dirs: ['agents', 'commands', 'skills', 'output-styles'],
    extra: { from: '.claude.json', as: 'claude.json' },
  },
  codex: { folder: '.codex', files: ['AGENTS.md', 'config.toml'], dirs: ['prompts', 'skills'] },
}

const SKIP_DIRS = new Set(['node_modules', '.git'])
const decoder = new TextDecoder('utf-8', { fatal: true })

async function readText(path: string): Promise<string | null> {
  const info = await lstat(path).catch(() => null)
  // Symlinks are skipped: they can point outside the folder being collected.
  if (!info || !info.isFile() || info.size > AGENT_PROFILE_LIMITS.maxFileBytes) return null
  try {
    return decoder.decode(await readFile(path))
  } catch (_error) {
    return null
  }
}

async function walk(root: string, directory: string, out: AgentProfileFile[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (out.length >= AGENT_PROFILE_LIMITS.maxFiles * 2) return
    const full = join(directory, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(root, full, out)
      continue
    }
    if (!entry.isFile()) continue
    const content = await readText(full)
    if (content !== null) out.push({ path: relative(root, full).split(sep).join('/'), content })
  }
}

/** Reads only the allowlisted parts of a person's `~/.claude` or `~/.codex`. */
export async function collectProfileFiles(harness: AgentProfileHarness, home = homedir()): Promise<AgentProfileFile[]> {
  const spec = COLLECT[harness]
  const root = join(home, spec.folder)
  const out: AgentProfileFile[] = []
  for (const name of spec.files) {
    const content = await readText(join(root, name))
    if (content !== null) out.push({ path: name, content })
  }
  for (const directory of spec.dirs) await walk(root, join(root, directory), out)
  if (spec.extra) {
    const content = await readText(join(home, spec.extra.from))
    if (content !== null) out.push({ path: spec.extra.as, content })
  }
  return out
}

export function uploadFromAnalysis(analysis: AnalyzedProfile): AgentProfileUpload {
  return {
    harness: analysis.harness,
    files: analysis.files,
    mcpServers: analysis.mcpServers,
    hooks: analysis.hooks,
    secrets: analysis.secrets,
  }
}

export function describeAnalysis(analysis: AnalyzedProfile): string[] {
  const summary = summarizeAgentProfile(analysis)
  const lines = [
    `Collected ${summary.files} files (${Math.round(summary.bytes / 1024)} KB): ` + [
      summary.claudeMd ? 'CLAUDE.md' : '', summary.agentsMd ? 'AGENTS.md' : '', summary.settings ? 'settings' : '',
      summary.skills ? `${summary.skills} skills` : '', summary.commands ? `${summary.commands} commands` : '',
      summary.subagents ? `${summary.subagents} subagents` : '', summary.outputStyles ? `${summary.outputStyles} output styles` : '',
      summary.prompts ? `${summary.prompts} prompts` : '', summary.mcpServers ? `${summary.mcpServers} MCP servers` : '',
    ].filter(Boolean).join(', '),
  ]
  if (summary.hooks) lines.push(`${summary.hooks} hooks or commands were left out; they stay off until you turn them on in Overlay.`)
  if (analysis.secrets.length) lines.push(`Values for ${analysis.secrets.map((secret) => secret.name).join(', ')} were not copied; Overlay will ask you for them.`)
  if (analysis.redactions.length) lines.push(`Secret-looking text was removed from ${analysis.redactions.length} files.`)
  if (analysis.dropped.length) lines.push(`${analysis.dropped.length} items were left out (see them in Overlay).`)
  return lines
}

export type ExportConfigOptions = {
  harness: AgentProfileHarness
  serverUrl: string
  code: string
  home?: string
  dryRun?: boolean
  fetchImpl?: typeof fetch
  log?: (line: string) => void
}

/** Collects, cleans on this computer, and uploads one profile. Nothing leaves the computer before it is cleaned. */
export async function exportConfig(options: ExportConfigOptions): Promise<{ analysis: AnalyzedProfile; uploaded: boolean }> {
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`))
  const files = await collectProfileFiles(options.harness, options.home)
  const analysis = analyzeAgentProfile(options.harness, [
    ...files.filter((file) => file.path !== 'claude.json'),
    ...files.filter((file) => file.path === 'claude.json'),
  ])
  for (const line of describeAnalysis(analysis)) log(line)
  if (options.dryRun) {
    log('Dry run: nothing was uploaded.')
    return { analysis, uploaded: false }
  }
  if (analysis.files.length === 0 && Object.keys(analysis.mcpServers).length === 0) {
    throw new Error(`Nothing to import: no ${options.harness === 'claude-code' ? 'Claude Code' : 'Codex'} configuration was found.`)
  }
  const body = gzipSync(Buffer.from(JSON.stringify(uploadFromAnalysis(analysis))))
  const response = await (options.fetchImpl ?? fetch)(`${options.serverUrl.replace(/\/+$/, '')}/api/v1/agent-profiles/upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/gzip', authorization: `Bearer ${options.code}` },
    body,
  })
  if (!response.ok) {
    const message = await response.json().then((json: { error?: string }) => json.error, () => undefined)
    throw new Error(message ?? `Overlay refused the upload (${response.status}).`)
  }
  log('Uploaded. Open the agent in Overlay to review and apply it.')
  return { analysis, uploaded: true }
}
