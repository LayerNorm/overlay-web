// Simple Convex HTTP client for the Electron main process
// Uses direct HTTP calls to Convex backend

import { app } from 'electron'

// Note: dotenv is loaded at the start of main/index.ts before any imports
// so environment variables should be available if set in .env

const appServerUrl = process.env.APP_SERVER_URL || ''
const isUsingProdServer = Boolean(appServerUrl && !appServerUrl.includes('localhost'))
const isDev = !app.isPackaged && !isUsingProdServer

const DEFAULT_DEV_DEPLOYMENT = 'different-caiman-77'
const DEFAULT_PROD_DEPLOYMENT = 'colorful-chickadee-419'

function toConvexCloudUrl(value: string): string {
  return value.replace(/\.cloud\.convex\.cloud$/, '.convex.cloud')
}

function deploymentToUrl(deployment: string | undefined): string | null {
  if (!deployment) return null
  const slug = deployment
    .trim()
    .replace(/^dev:/, '')
    .replace(/^prod:/, '')
    .trim()
  if (!slug) return null
  return `https://${slug}.convex.cloud`
}

function resolveConvexUrl(): { url: string; source: string; deployment: string } {
  if (process.env.CONVEX_URL) {
    return {
      url: toConvexCloudUrl(process.env.CONVEX_URL),
      source: 'CONVEX_URL',
      deployment: isDev ? 'custom-dev' : 'custom-prod'
    }
  }

  if (isDev) {
    if (process.env.VITE_CONVEX_URL) {
      return {
        url: toConvexCloudUrl(process.env.VITE_CONVEX_URL),
        source: 'VITE_CONVEX_URL',
        deployment: process.env.CONVEX_DEPLOYMENT || `dev:${DEFAULT_DEV_DEPLOYMENT}`
      }
    }

    if (process.env.DEV_CONVEX_URL) {
      return {
        url: toConvexCloudUrl(process.env.DEV_CONVEX_URL),
        source: 'DEV_CONVEX_URL',
        deployment: process.env.CONVEX_DEPLOYMENT || `dev:${DEFAULT_DEV_DEPLOYMENT}`
      }
    }

    const derivedDevUrl =
      deploymentToUrl(process.env.CONVEX_DEPLOYMENT) ||
      deploymentToUrl(`dev:${DEFAULT_DEV_DEPLOYMENT}`)
    if (!derivedDevUrl) {
      throw new Error('Unable to resolve Convex dev URL')
    }

    return {
      url: derivedDevUrl,
      source: 'CONVEX_DEPLOYMENT',
      deployment: process.env.CONVEX_DEPLOYMENT || `dev:${DEFAULT_DEV_DEPLOYMENT}`
    }
  }

  if (process.env.CONVEX_PROD_URL) {
    return {
      url: toConvexCloudUrl(process.env.CONVEX_PROD_URL),
      source: 'CONVEX_PROD_URL',
      deployment: process.env.CONVEX_PROD_DEPLOYMENT || DEFAULT_PROD_DEPLOYMENT
    }
  }

  if (process.env.NEXT_PUBLIC_CONVEX_URL) {
    return {
      url: toConvexCloudUrl(process.env.NEXT_PUBLIC_CONVEX_URL),
      source: 'NEXT_PUBLIC_CONVEX_URL',
      deployment: process.env.CONVEX_PROD_DEPLOYMENT || DEFAULT_PROD_DEPLOYMENT
    }
  }

  const derivedProdUrl =
    deploymentToUrl(process.env.CONVEX_PROD_DEPLOYMENT) ||
    deploymentToUrl(DEFAULT_PROD_DEPLOYMENT)
  if (!derivedProdUrl) {
    throw new Error('Unable to resolve Convex prod URL')
  }

  return {
    url: derivedProdUrl,
    source: 'CONVEX_PROD_DEPLOYMENT',
    deployment: process.env.CONVEX_PROD_DEPLOYMENT || DEFAULT_PROD_DEPLOYMENT
  }
}

const {
  url: CONVEX_URL,
  source: CONVEX_URL_SOURCE,
  deployment: CONVEX_DEPLOYMENT_NAME
} = resolveConvexUrl()

console.log(
  `[Convex] Using URL: ${CONVEX_URL} (source: ${CONVEX_URL_SOURCE}, deployment: ${CONVEX_DEPLOYMENT_NAME}, isDev: ${isDev})`
)

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
  mutation: <T>(path: string, args: Record<string, unknown>) => callConvex<T>('mutation', path, args),
  action: <T>(path: string, args: Record<string, unknown>) => callConvex<T>('action', path, args)
}
