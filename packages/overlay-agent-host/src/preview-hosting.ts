import { consumePreviewHostingAccess, previewHostingFetch } from './preview-hosting-access.js'

/** QA-only: a protected Preview's hosting access exists for this host lifetime and never enters configuration. */
export async function withPreviewHostingAccess<T>(path: string | undefined, serverUrl: string,
  work: (fetch?: typeof globalThis.fetch) => Promise<T>): Promise<T> {
  if (!path) return work()
  const access = await consumePreviewHostingAccess(path, serverUrl)
  delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  return work(previewHostingFetch(access))
}
