// Simple Convex HTTP client for the Electron main process
// Uses direct HTTP calls to Convex backend

import { app } from 'electron'

// Note: dotenv is loaded at the start of main/index.ts before any imports
// so environment variables should be available if set in .env

const appServerUrl = process.env.APP_SERVER_URL || ''
const isUsingProdServer = Boolean(appServerUrl && !appServerUrl.includes('localhost'))
const isDev = !app.isPackaged && !isUsingProdServer

function toConvexCloudUrl(value: string): string {
  return value.replace(/\.cloud\.convex\.cloud$/, '.convex.cloud')
}

function deploymentNameFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname
    const match = host.match(/^([a-z0-9-]+)\.convex\.cloud$/i)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

function resolveConvexUrl(): { url: string; source: string; deployment: string } {
  const candidates: Array<[string, string | undefined]> = isDev
    ? [
        ['CONVEX_URL', process.env.CONVEX_URL],
        ['VITE_CONVEX_URL', process.env.VITE_CONVEX_URL],
        ['DEV_CONVEX_URL', process.env.DEV_CONVEX_URL],
        ['DEV_NEXT_PUBLIC_CONVEX_URL', process.env.DEV_NEXT_PUBLIC_CONVEX_URL],
        ['NEXT_PUBLIC_CONVEX_URL', process.env.NEXT_PUBLIC_CONVEX_URL]
      ]
    : [
        ['CONVEX_URL', process.env.CONVEX_URL],
        ['CONVEX_PROD_URL', process.env.CONVEX_PROD_URL],
        ['NEXT_PUBLIC_CONVEX_URL', process.env.NEXT_PUBLIC_CONVEX_URL]
      ]

  for (const [source, value] of candidates) {
    const trimmed = value?.trim()
    if (!trimmed) continue
    const url = toConvexCloudUrl(trimmed)
    const deployment =
      process.env.CONVEX_DEPLOYMENT?.trim() ||
      process.env.CONVEX_PROD_DEPLOYMENT?.trim() ||
      deploymentNameFromUrl(url) ||
      'configured'
    return { url, source, deployment }
  }

  return {
    url: '',
    source: 'unconfigured',
    deployment: 'unconfigured'
  }
}

const {
  url: CONVEX_URL,
  source: CONVEX_URL_SOURCE,
  deployment: CONVEX_DEPLOYMENT_NAME
} = resolveConvexUrl()

if (CONVEX_URL) {
  console.log(
    `[Convex] Using URL: ${CONVEX_URL} (source: ${CONVEX_URL_SOURCE}, deployment: ${CONVEX_DEPLOYMENT_NAME}, isDev: ${isDev})`
  )
} else {
  console.warn(
    '[Convex] No Convex URL configured. Set CONVEX_URL (or DEV_NEXT_PUBLIC_CONVEX_URL / NEXT_PUBLIC_CONVEX_URL). Direct Convex calls will fail closed.'
  )
}

interface ConvexResponse<T> {
  status: 'success' | 'error'
  value?: T
  errorMessage?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function callConvex<T>(
  type: 'query' | 'mutation' | 'action',
  path: string,
  args: Record<string, unknown>
): Promise<T | null> {
  if (!CONVEX_URL) {
    console.error('[Convex] CONVEX_URL not configured')
    return null
  }

  // Normalize URL format
  const url = toConvexCloudUrl(CONVEX_URL)
  const endpoint = `${url}/api/${type}`

  try {
    console.log(`[Convex] Calling ${type}: ${path}`)
    if (path === 'platform/usage:recordBatch' && Array.isArray(args.events)) {
      const embeddingEvents = args.events.filter(
        (event) =>
          isRecord(event) &&
          (event.type === 'embedding' || event.type === 'ask' || event.type === 'agent')
      ).length
      if (embeddingEvents > 0) {
        console.log(
          `[Convex] usage:recordBatch payload contains ${embeddingEvents} billable token events`
        )
      }
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        path,
        args,
        format: 'json'
      })
    })

    const data: ConvexResponse<T> = await response.json()

    if (
      path === 'platform/usage:getEntitlements' &&
      data.status === 'success' &&
      isRecord(data.value)
    ) {
      const tier = typeof data.value.tier === 'string' ? data.value.tier : 'unknown'
      console.log(`[Convex] Response for ${path}: status=success tier=${tier}`)
    } else {
      console.log(`[Convex] Response for ${path}: status=${data.status}`)
    }

    if (data.status === 'error') {
      console.error(`[Convex] ${type} error:`, data.errorMessage)
      if (
        path === 'platform/usage:recordBatch' &&
        data.errorMessage?.includes('Value: "embedding"') &&
        CONVEX_URL_SOURCE !== 'CONVEX_URL'
      ) {
        console.error(
          `[Convex] The active deployment at ${CONVEX_URL} does not include the latest usage schema. ` +
            `Set CONVEX_URL explicitly or sync the target deployment with \`npx convex dev --once\`.`
        )
      }
      return null
    }

    return data.value ?? null
  } catch (error) {
    console.error(`[Convex] ${type} failed:`, error)
    return null
  }
}

export const convexClient = {
  query: <T>(path: string, args: Record<string, unknown>) => callConvex<T>('query', path, args),
  mutation: <T>(path: string, args: Record<string, unknown>) =>
    callConvex<T>('mutation', path, args),
  action: <T>(path: string, args: Record<string, unknown>) => callConvex<T>('action', path, args)
}
