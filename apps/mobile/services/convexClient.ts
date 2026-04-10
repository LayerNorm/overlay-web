import { CONVEX_URL } from './appConfig'

interface ConvexResponse<T> {
  status: 'success' | 'error'
  value?: T
  errorMessage?: string
}

function getConvexEndpoint(): string | null {
  if (!CONVEX_URL) {
    return null
  }

  return CONVEX_URL.replace(/\.cloud\.convex\.cloud$/, '.convex.cloud')
}

async function callConvex<T>(
  type: 'query' | 'mutation' | 'action',
  path: string,
  args: Record<string, unknown>
): Promise<T | null> {
  const endpointBase = getConvexEndpoint()

  if (!endpointBase) {
    return null
  }

  const response = await fetch(`${endpointBase}/api/${type}`, {
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

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Convex ${type} failed: ${response.status} ${errorText}`)
  }

  const data = (await response.json()) as ConvexResponse<T>

  if (data.status === 'error') {
    throw new Error(data.errorMessage || `Convex ${type} failed`)
  }

  return data.value ?? null
}

export const convexClient = {
  query: <T>(path: string, args: Record<string, unknown>) => callConvex<T>('query', path, args),
  mutation: <T>(path: string, args: Record<string, unknown>) =>
    callConvex<T>('mutation', path, args),
  action: <T>(path: string, args: Record<string, unknown>) => callConvex<T>('action', path, args)
}
