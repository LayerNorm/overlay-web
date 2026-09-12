import { WorkOS } from '@workos-inc/node'
import { summarizeJwtForLog, summarizeOpaqueTokenForLog } from '../../src/server/auth/auth-debug.ts'

function getArg(name: string): string | null {
  const exact = `--${name}`
  const prefix = `--${name}=`
  const index = process.argv.findIndex((arg) => arg === exact || arg.startsWith(prefix))
  if (index === -1) return null
  const value = process.argv[index]!
  if (value === exact) {
    return process.argv[index + 1] ?? null
  }
  return value.slice(prefix.length)
}

async function inspectConvex(accessToken: string, userId?: string) {
  const convexUrl = process.env.DEV_NEXT_PUBLIC_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL
  const serverSecret = process.env.INTERNAL_API_SECRET
  if (!convexUrl || !serverSecret) {
    return null
  }

  const response = await fetch(`${convexUrl}/api/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      path: 'authDebug:inspectAccessToken',
      format: 'json',
      args: {
        serverSecret,
        accessToken,
        userId: userId || undefined,
      },
    }),
  })

  return await response.text()
}

async function main() {
  const apiKey = process.env.DEV_WORKOS_API_KEY || process.env.WORKOS_API_KEY
  const clientId = process.env.DEV_WORKOS_CLIENT_ID || process.env.WORKOS_CLIENT_ID
  const refreshToken = getArg('refresh-token') || process.env.REFRESH_TOKEN || null
  const expectedUserId = getArg('user-id') || process.env.USER_ID || null

  if (!apiKey) throw new Error('Missing DEV_WORKOS_API_KEY or WORKOS_API_KEY')
  if (!clientId) throw new Error('Missing DEV_WORKOS_CLIENT_ID or WORKOS_CLIENT_ID')
  if (!refreshToken) throw new Error('Missing refresh token. Pass --refresh-token or REFRESH_TOKEN')

  const workos = new WorkOS({ apiKey })
  const response = await workos.userManagement.authenticateWithRefreshToken({
    clientId,
    refreshToken,
  })

  console.log(
    JSON.stringify(
      {
        responseUserId: response.user.id,
        expectedUserId,
        matchesExpectedUser: expectedUserId ? response.user.id === expectedUserId : null,
        accessToken: summarizeJwtForLog(response.accessToken),
        refreshToken: summarizeOpaqueTokenForLog(response.refreshToken),
      },
      null,
      2,
    ),
  )

  const convexInspection = await inspectConvex(response.accessToken, expectedUserId || response.user.id)
  if (convexInspection) {
    console.log(convexInspection)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
