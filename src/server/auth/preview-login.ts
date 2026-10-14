import 'server-only'

import { WorkOS } from '@workos-inc/node'
import { createSession } from './workos-auth'
import { previewLoginResponse } from './preview-login-policy'
import { deploymentEnv } from '@/server/env/deployment-env'

export function handlePreviewLogin(request: Request, rateLimit: () => Promise<Response | null>): Promise<Response> {
  return previewLoginResponse(request, deploymentEnv(), {
    authenticate: async (email, password) => {
      const workos = new WorkOS({ apiKey: process.env.WORKOS_API_KEY })
      const response = await workos.userManagement.authenticateWithPassword({
        clientId: process.env.WORKOS_CLIENT_ID!, email, password,
      })
      return {
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        expiresAt: Date.now() + 60 * 60 * 1000,
        user: {
          id: response.user.id, email: response.user.email,
          firstName: response.user.firstName ?? undefined,
          lastName: response.user.lastName ?? undefined,
          emailVerified: response.user.emailVerified,
        },
      }
    },
    saveSession: createSession,
    rateLimit,
  })
}
