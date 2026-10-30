import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

/** The desktop shares web renderers by loading the app, rather than vendoring them. */
export function desktopWebShellViolations(root) {
  const failures = []
  const desktop = join(root, 'overlay-desktop')
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
  ]) {
    if (existsSync(join(desktop, 'packages', name)))
      failures.push(`desktop must not vendor ${name}`)
  }
  const canonical = read(
    join(root, 'packages/overlay-desktop-bridge/src/index.ts'),
  )
  const vendored = read(
    join(desktop, 'packages/overlay-desktop-bridge/src/index.ts'),
  )
  if (!canonical || vendored !== canonical)
    failures.push('desktop must vendor the exact canonical bridge contract')
  if (canonical) {
    const fingerprint = createHash('sha256').update(canonical).digest('hex')
    for (const base of [root, desktop]) {
      if (
        read(
          join(base, 'packages/overlay-desktop-bridge/source.sha256'),
        )?.trim() !== fingerprint
      )
        failures.push('desktop bridge fingerprint must match its source')
    }
  }
  const webEnrollment = read(
    join(root, 'src/server/agents/agent-enrollment-command.ts'),
  )
  const hostVersion =
    /OVERLAY_AGENT_HOST_PACKAGE_VERSION = ['"]([^'"]+)['"]/.exec(
      webEnrollment ?? '',
    )?.[1]
  const nativeHostConfig = read(
    join(desktop, 'src/main/services/embedded-host-config.ts'),
  )
  if (
    !hostVersion ||
    !nativeHostConfig?.includes(`@layernorm/overlay-agent-host@${hostVersion}'`)
  )
    failures.push('desktop Agent Host pin must match web enrollment')
  const manifest = read(join(desktop, 'package.json'))
  if (!manifest) failures.push('desktop manifest is missing')
  else {
    const parsed = JSON.parse(manifest)
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
