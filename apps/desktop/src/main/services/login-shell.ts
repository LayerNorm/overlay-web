import { execFile } from 'node:child_process'
import { homedir } from 'node:os'

const SHELL_TIMEOUT_MS = 5_000
const ENV_MARKER = '__OVERLAY_ENV__'

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

let loginPath: Promise<string | null> | null = null

/**
 * The login shell's PATH, read once per app session. Local MCP servers are usually started with `npx`, `uvx` or
 * `docker`, which live in folders an app opened from the Dock doesn't have on its PATH.
 */
export function loginShellPath(): Promise<string | null> {
  loginPath ??= readLoginShellEnvironment().then((environment) => environment.PATH?.trim() || null, () => null)
  return loginPath
}
