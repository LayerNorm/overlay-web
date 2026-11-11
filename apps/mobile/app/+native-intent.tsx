import { incomingRoute } from '../lib/incomingLinks'

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return incomingRoute(path, __DEV__)
}
