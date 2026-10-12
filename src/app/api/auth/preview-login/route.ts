import type { NextRequest } from 'next/server'
import { handlePreviewLogin } from '@/server/auth/preview-login'
import { rateLimitByIp } from '@/server/security/rate-limit'

export async function POST(request: NextRequest) {
  return handlePreviewLogin(request, () => rateLimitByIp(request, 'auth:preview-login:ip', 10, 60_000))
}
