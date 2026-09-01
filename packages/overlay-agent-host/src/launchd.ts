import { execFile } from 'node:child_process'
import { chmod, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, posix } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type LaunchAgentDefinition = {
  environmentId: string
  configPath: string
  stateDirectory: string
  packageSpec: string
  executablePath?: string
}

export function launchAgentLabel(environmentId: string) {
  return `com.layernorm.overlay-agent-host.${environmentId.replace(/[^A-Za-z0-9.-]/g, '-')}`
}

export function launchAgentPlist(input: LaunchAgentDefinition) {
  const label = launchAgentLabel(input.environmentId)
  const executablePath = input.executablePath ?? launchAgentExecutablePath()
  const command = [
    'exec npx --yes --package node@24 --package',
    shellQuote(input.packageSpec),
    'overlay-agent-host run --config',
    shellQuote(input.configPath),
  ].join(' ')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array><string>/bin/zsh</string><string>-lc</string><string>${xml(command)}</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xml(executablePath)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(join(input.stateDirectory, 'launchd.stdout.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(join(input.stateDirectory, 'launchd.stderr.log'))}</string>
</dict>
</plist>
`
}

export function launchAgentExecutablePath(source = process.env.PATH, home = homedir()) {
  const candidates = [
    ...(source?.split(':') ?? []),
    posix.join(home.replaceAll('\\', '/'), '.local', 'bin'),
    posix.join(home.replaceAll('\\', '/'), '.cargo', 'bin'),
    posix.join(home.replaceAll('\\', '/'), '.bun', 'bin'),
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ]
  return [...new Set(candidates.filter((entry) => entry.startsWith('/')))].join(':')
}

export async function installLaunchAgent(input: LaunchAgentDefinition) {
  assertMacOS()
  const path = launchAgentPath(input.environmentId)
  await mkdir(dirname(path), { recursive: true })
  await mkdir(input.stateDirectory, { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, launchAgentPlist(input), { mode: 0o600, flag: 'wx' })
  await rename(temporary, path)
  await chmod(path, 0o600)
  const domain = launchAgentDomain()
  await execFileAsync('launchctl', ['bootout', domain, path]).catch(() => undefined)
  await execFileAsync('launchctl', ['bootstrap', domain, path])
  await execFileAsync('launchctl', ['kickstart', '-k', `${domain}/${launchAgentLabel(input.environmentId)}`])
  return path
}

export async function uninstallLaunchAgent(environmentId: string) {
  assertMacOS()
  const path = launchAgentPath(environmentId)
  await execFileAsync('launchctl', ['bootout', launchAgentDomain(), path]).catch(() => undefined)
  await unlink(path).catch((error: unknown) => {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  })
  return path
}

export async function launchAgentStatus(environmentId: string) {
  assertMacOS()
  return await execFileAsync('launchctl', ['print', `${launchAgentDomain()}/${launchAgentLabel(environmentId)}`])
}

function launchAgentPath(environmentId: string) {
  return join(homedir(), 'Library', 'LaunchAgents', `${launchAgentLabel(environmentId)}.plist`)
}

function launchAgentDomain() {
  const uid = process.getuid?.()
  if (uid === undefined) throw new Error('Could not determine the current macOS user')
  return `gui/${uid}`
}

function assertMacOS() {
  if (process.platform !== 'darwin') throw new Error('LaunchAgent service management is available only on macOS')
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function xml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
