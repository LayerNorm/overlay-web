import type { NextRequest } from 'next/server'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ provider: string; path: string[] }> }

/**
 * Metered model proxy for agent CLIs inside Overlay machines. Auth is the
 * scoped agent-gateway bearer token (minted per exec call), not the session
 * cookie — deliberately outside the BFF wrapper.
 */
async function proxy(request: NextRequest, context: RouteContext) {
  const { handleAgentGatewayRequest } = await import('@/server/ai/agent-gateway/proxy')
  return handleAgentGatewayRequest(request, await context.params)
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, context)
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, context)
}
