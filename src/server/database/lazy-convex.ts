import 'server-only'

type ConvexCallOptions = {
  timeoutMs?: number
  throwOnError?: boolean
  background?: boolean
  suppressNetworkConsoleError?: boolean
}

async function getConvex() {
  return (await import('@/server/database/convex')).convex
}

export const lazyConvex = {
  query: async <T>(
    path: string,
    args: Record<string, unknown>,
    options?: ConvexCallOptions,
  ) => (await getConvex()).query<T>(path, args, options),
  mutation: async <T>(
    path: string,
    args: Record<string, unknown>,
    options?: ConvexCallOptions,
  ) => (await getConvex()).mutation<T>(path, args, options),
  action: async <T>(
    path: string,
    args: Record<string, unknown>,
    options?: ConvexCallOptions,
  ) => (await getConvex()).action<T>(path, args, options),
}
