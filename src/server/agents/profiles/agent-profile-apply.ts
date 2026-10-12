import type { AgentProfileBundle, AgentProfileHarness } from '@layernorm/overlay-agent-bridge-protocol'

/** Where each harness keeps its config on an Overlay Cloud machine (`/home/user`; see `cloud-agent-machine.ts`). */
export const PROFILE_HARNESS_HOME: Record<AgentProfileHarness, string> = {
  'claude-code': '/home/user/.claude',
  codex: '/home/user/.codex',
}
export const CLAUDE_JSON_PATH = '/home/user/.claude.json'
export const PROFILE_MANAGED_PATH = '/home/user/.overlay/profile-managed.json'

/** What an apply left on the machine, so the next one can remove what no longer belongs. */
export type ManagedProfile = { version: number; harness: AgentProfileHarness; files: string[]; mcpServers: string[] }

export type ProfileApplyPlan = {
  writes: Array<{ path: string; content: string; executable: boolean }>
  removes: string[]
  manifest: ManagedProfile
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function withHooks(bundle: AgentProfileBundle, settingsJson: string | undefined): string {
  const settings: Record<string, unknown> = settingsJson ? (JSON.parse(settingsJson) as Record<string, unknown>) : {}
  const hooks: Record<string, unknown[]> = {}
  for (const hook of bundle.hooks) {
    if (hook.kind === 'hook') (hooks[hook.event] ??= []).push({ hooks: [{ type: 'command', command: hook.command }] })
    if (hook.kind === 'statusline') settings.statusLine = { type: 'command', command: hook.command }
  }
  if (Object.keys(hooks).length > 0) settings.hooks = hooks
  return `${JSON.stringify(settings, null, 2)}\n`
}

/**
 * What to put on the machine for a profile: files under the harness's config folder, MCP servers merged into
 * `~/.claude.json` (everything else in it kept), and the removal of what an earlier apply wrote that this one does not.
 * Hooks and notify commands are written only when the person has turned them on.
 */
export function planProfileApply(args: {
  bundle: AgentProfileBundle
  hooksEnabled: boolean
  version: number
  previous: ManagedProfile | null
  existingClaudeJson: string | null
}): { plan: ProfileApplyPlan; claudeJson: string | null } {
  const { bundle } = args
  const home = PROFILE_HARNESS_HOME[bundle.harness]
  const writes: ProfileApplyPlan['writes'] = []
  const paths = new Set<string>()
  for (const file of bundle.files) {
    let content = file.content
    if (args.hooksEnabled && bundle.harness === 'claude-code' && file.path === 'settings.json') content = withHooks(bundle, content)
    if (args.hooksEnabled && bundle.harness === 'codex' && file.path === 'config.toml') {
      const notify = bundle.hooks.find((hook) => hook.kind === 'notify')
      if (notify) content = `notify = ${notify.command}\n${content}`
    }
    paths.add(file.path)
    writes.push({ path: `${home}/${file.path}`, content, executable: content.startsWith('#!') })
  }
  // Hooks need a settings file even when the person imported none.
  if (args.hooksEnabled && bundle.harness === 'claude-code' && !paths.has('settings.json') && bundle.hooks.some((hook) => hook.kind !== 'notify')) {
    paths.add('settings.json')
    writes.push({ path: `${home}/settings.json`, content: withHooks(bundle, undefined), executable: false })
  }
  const previousFiles = args.previous?.harness === bundle.harness ? args.previous.files : []
  const removes = previousFiles.filter((path) => !paths.has(path)).map((path) => `${home}/${path}`)

  let claudeJson: string | null = null
  const serverNames = Object.keys(bundle.mcpServers)
  const previousServers = args.previous?.harness === 'claude-code' ? args.previous.mcpServers : []
  if (bundle.harness === 'claude-code' && (serverNames.length > 0 || previousServers.length > 0)) {
    const existing: Record<string, unknown> = args.existingClaudeJson ? (JSON.parse(args.existingClaudeJson) as Record<string, unknown>) : {}
    const servers: Record<string, unknown> = isRecord(existing.mcpServers) ? { ...existing.mcpServers } : {}
    for (const name of previousServers) if (!serverNames.includes(name)) delete servers[name]
    for (const name of serverNames) servers[name] = bundle.mcpServers[name]
    claudeJson = `${JSON.stringify({ ...existing, mcpServers: servers }, null, 2)}\n`
  }
  return {
    plan: { writes, removes, manifest: { version: args.version, harness: bundle.harness, files: [...paths], mcpServers: serverNames } },
    claudeJson,
  }
}
