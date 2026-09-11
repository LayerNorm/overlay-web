import { createHmac, timingSafeEqual } from 'crypto'
import { summarizeSessionForLog } from '../../src/server/auth/auth-debug.ts'
import { decryptSessionCookiePayload } from '../../src/server/auth/session-transfer-crypto.ts'

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

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

function verifySignedCookie(cookieValue: string, secret: string): string | null {
  const separatorIndex = cookieValue.lastIndexOf('.')
  if (separatorIndex === -1) return null
  const payload = cookieValue.substring(0, separatorIndex)
  const signature = cookieValue.substring(separatorIndex + 1)
  const expectedSignature = signPayload(payload, secret)
  try {
    const sigBuf = Buffer.from(signature, 'hex')
    const expectedBuf = Buffer.from(expectedSignature, 'hex')
    if (sigBuf.length !== expectedBuf.length) return null
    if (!timingSafeEqual(sigBuf, expectedBuf)) return null
  } catch {
    return null
  }
  return payload
}

async function maybeInspectConvex(accessToken: string, userId?: string) {
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
  const cookie = getArg('cookie') || process.env.OVERLAY_SESSION_COOKIE || null
  const secret = process.env.SESSION_SECRET || null
  if (!cookie) throw new Error('Missing cookie. Pass --cookie or OVERLAY_SESSION_COOKIE')
  if (!secret) throw new Error('Missing SESSION_SECRET')

  const normalizedCookie = cookie.includes('%') ? decodeURIComponent(cookie) : cookie
  const payload = verifySignedCookie(normalizedCookie, secret)
  if (!payload) throw new Error('Cookie signature invalid')

  let session: {
    accessToken: string
    refreshToken: string
    user: { id: string }
    expiresAt: number
  }

  try {
    session = JSON.parse(decryptSessionCookiePayload(payload)) as {
      accessToken: string
      refreshToken: string
      user: { id: string }
      expiresAt: number
    }
  } catch {
    session = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8')) as {
      accessToken: string
      refreshToken: string
      user: { id: string }
      expiresAt: number
    }
  }

  console.log(JSON.stringify({ session: summarizeSessionForLog(session) }, null, 2))

  const convexInspection = await maybeInspectConvex(session.accessToken, session.user.id)
  if (convexInspection) {
    console.log(convexInspection)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
