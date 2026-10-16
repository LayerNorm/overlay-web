import type {AgentAdapter} from './adapter.js'
import {consumePreviewHostingAccess, previewHostingFetch} from './preview-hosting-access.js'
import {createPreviewMcpRelay} from './preview-mcp-relay.js'

export type PreviewHostingTransport = {
  fetch: typeof globalThis.fetch
  wrapAdapter(adapter: AgentAdapter): AgentAdapter
}

/** Hosting access exists only for this host lifetime and never enters adapter configuration. */
export async function withPreviewHostingAccess<T>(path: string | undefined, serverUrl: string,
  work: (transport?: PreviewHostingTransport) => Promise<T>): Promise<T> {
  if (!path) return work()
  const access = await consumePreviewHostingAccess(path, serverUrl)
  // Provider children must not inherit an unrelated shell/dashboard hosting variable either.
  delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  const fetch = previewHostingFetch(access)
  const relay = await createPreviewMcpRelay(access.origin, fetch)
  try {return await work({fetch, wrapAdapter: relay.wrapAdapter})} finally {await relay.close()}
}
