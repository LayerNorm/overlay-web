import type { NextRequest } from 'next/server'
import { convex } from '@/server/database/convex'
import { getInternalApiSecret } from '@/server/shared/internal-api-secret'
import { decryptSessionTransferPayload } from '@/server/auth/session-transfer-crypto'
import { createSession } from '@/server/auth/workos-auth'
import { desktopWebSessionResponse } from '@/server/auth/desktop-web-session-policy'
import { rateLimitByIp } from '@/server/security/rate-limit'

export async function GET(request: NextRequest) {
  return desktopWebSessionResponse(request, {
    consumeToken: async (token, codeVerifier) => {
      const encrypted = await convex.mutation<string | null>('auth/sessionTransfer:consumeToken', {
        token,
        codeVerifier,
        serverSecret: getInternalApiSecret(),
      })
      return encrypted ? decryptSessionTransferPayload(encrypted) : null
    },
    saveSession: createSession,
    rateLimit: () => rateLimitByIp(request, 'auth:desktop-web-session:ip', 20, 10 * 60_000),
  })
}
