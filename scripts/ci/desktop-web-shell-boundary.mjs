import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The desktop shares web renderers by loading the app, rather than vendoring them. */
export function desktopWebShellViolations(root) {
  const failures = []
  const desktop = join(root, 'apps/desktop')
  const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null)
  const entry = read(join(desktop, 'src/main/index.ts'))
  if (!entry?.includes("from './services/web-shell'"))
    failures.push('desktop entry must load the canonical web shell')
  for (const path of [
    'src/renderer/src',
    'src/main/services/ai',
    'src/main/services/chat-service.ts',
    'src/main/services/openrouter-chat-service.ts',
    'src/main/services/convex-client.ts',
  ]) {
    if (existsSync(join(desktop, path)))
      failures.push(`desktop ${path} must stay retired`)
  }
  for (const name of [
    'overlay-chat-react',
    'overlay-shell-react',
    'overlay-modules-react',
    'overlay-api-client',
    'overlay-llm-gateway',
    'overlay-desktop-bridge',
  ]) {
    if (existsSync(join(desktop, 'packages', name)))
      failures.push(`desktop must not vendor ${name}`)
  }
  if (!existsSync(join(root, 'packages/overlay-desktop-bridge/src/index.ts')))
    failures.push('the shared desktop bridge contract is missing')
  const webEnrollment = read(
    join(root, 'src/server/agents/agent-enrollment-command.ts'),
  )
  const hostVersion =
    /OVERLAY_AGENT_HOST_PACKAGE_VERSION = ['"]([^'"]+)['"]/.exec(
      webEnrollment ?? '',
    )?.[1]
  // The desktop app ships the host it pins in agent-host-bundle/package.json.
  const bundledHost = read(join(desktop, 'agent-host-bundle/package.json'))
  const bundledHostVersion = bundledHost
    ? JSON.parse(bundledHost).dependencies?.['@layernorm/overlay-agent-host']
    : undefined
  if (!hostVersion || bundledHostVersion !== hostVersion)
    failures.push('desktop Agent Host pin must match web enrollment')
  const manifest = read(join(desktop, 'package.json'))
  if (!manifest) failures.push('desktop manifest is missing')
  else {
    const parsed = JSON.parse(manifest)
    // One bridge contract: the desktop links the shared package instead of copying it.
    if (parsed.dependencies?.['@overlay/desktop-bridge'] !== 'file:../../packages/overlay-desktop-bridge')
      failures.push('desktop must depend on the shared bridge package')
    for (const name of Object.keys({
      ...parsed.dependencies,
      ...parsed.devDependencies,
    })) {
      if (
        /^(?:ai|convex|openai|groq-sdk|@ai-sdk\/|@openrouter\/|@anthropic-ai\/|@composio\/|@google\/genai)/.test(
          name,
        )
      )
        failures.push(`desktop must not depend on provider SDK ${name}`)
    }
  }
  return failures
}
