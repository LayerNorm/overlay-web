import { getFunctionName } from 'convex/server'
import { resolveMutation, resolveQuery } from '../fixtures/convex'

type Ref = Parameters<typeof getFunctionName>[0]
const nameOf = (ref: unknown) => (typeof ref === 'string' ? ref : getFunctionName(ref as Ref))

export class ConvexHttpClient {
  constructor(_url?: string) {}
  setAuth() {}
  clearAuth() {}
  async query(ref: unknown, args?: Record<string, unknown>) { return resolveQuery(nameOf(ref), args ?? {}) }
  async mutation(ref: unknown, args?: Record<string, unknown>) { return resolveMutation(nameOf(ref), args ?? {}) }
  async action(ref: unknown, args?: Record<string, unknown>) { return resolveMutation(nameOf(ref), args ?? {}) }
}

export class ConvexClient extends ConvexHttpClient {
  onUpdate() { return () => undefined }
  close() {}
}
