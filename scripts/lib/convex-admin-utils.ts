import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type ConvexCallType = 'query' | 'mutation' | 'action'
export type DeploymentTarget = 'dev' | 'prod'

type ConvexResponse<T> =
  | { status: 'success'; value: T }
  | { status: 'error'; errorMessage?: string }

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function loadLocalEnv(): void {
  const envPath = resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  const raw = readFileSync(envPath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    const [, key, value] = match
    if (process.env[key] === undefined) {
      process.env[key] = stripQuotes(value)
    }
  }
}

export function resolveTargets(arg = 'both'): DeploymentTarget[] {
  const normalized = arg.toLowerCase()
  if (normalized === 'dev') return ['dev']
  if (normalized === 'prod') return ['prod']
  return ['prod', 'dev']
}

export function getConvexUrl(target: DeploymentTarget): string {
  const value =
    target === 'dev'
      ? process.env.DEV_NEXT_PUBLIC_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL
      : process.env.NEXT_PUBLIC_CONVEX_URL
  if (!value) {
    throw new Error(`Missing Convex URL for ${target} deployment`)
  }
  return value
}

export function getInternalApiSecret(): string {
  const value = process.env.INTERNAL_API_SECRET?.trim()
  if (!value) {
    throw new Error('Missing INTERNAL_API_SECRET')
  }
  return value
}

export async function callConvex<T>(
  target: DeploymentTarget,
  type: ConvexCallType,
  path: string,
  args: Record<string, unknown>,
): Promise<T> {
  const url = getConvexUrl(target)
  const res = await fetch(`${url}/api/${type}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' }),
  })

  const json = await res.json() as ConvexResponse<T>
  if (!res.ok || json.status === 'error') {
    throw new Error('errorMessage' in json ? (json.errorMessage ?? `Convex ${type} failed`) : `Convex ${type} failed`)
  }
  return json.value
}

export function readArg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  if (match) return match.slice(prefix.length)
  return fallback
}
