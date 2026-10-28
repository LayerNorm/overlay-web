import 'server-only'

import { tool, type ToolSet } from 'ai'
import {
  deepSearchInputSchema,
  webFetchInputSchema,
  webSearchInputSchema,
} from '@/server/tools/tools/web-search'

/**
 * Stubs for paid-only Act tools on the **free** plan only. Never merge this tool set for
 * paid users — they receive the real web_search/deep_search/web_fetch and `createWebTools` implementations.
 * `forFreeTierActOnly` must be true only in the free-tier Act path where those real
 * implementations are intentionally omitted or gated.
 */
export function createFreeTierGatedStubTools(forFreeTierActOnly: boolean): ToolSet {
  if (!forFreeTierActOnly) {
    return {}
  }
  return {
    web_search: tool({
      description:
        'Search the public web. On the free plan this tool only registers the need for web search — ' +
        'call it when the user needs live web lookup, news, or general search. ' +
        'For heavy multi-source research, also consider deep_search.',
      inputSchema: webSearchInputSchema,
      execute: async () => ({
        _overlayGatedFeature: true as const,
        feature: 'web_search' as const,
        message: 'Web search is available on a paid plan.',
      }),
    }),
    deep_search: tool({
      description:
        'Deep web research. On the free plan this tool only registers the need for deep research — ' +
        'call it when the user needs synthesis, long excerpts, or domain-scoped sources.',
      inputSchema: deepSearchInputSchema,
      execute: async () => ({
        _overlayGatedFeature: true as const,
        feature: 'deep_research' as const,
        message: 'Deep web research is available on a paid plan.',
      }),
    }),
    web_fetch: tool({
      description:
        'Fetch a URL and return clean page content. On the free plan this tool only registers the need ' +
        'for page fetching — call it when the user needs the contents of a specific URL.',
      inputSchema: webFetchInputSchema,
      execute: async () => ({
        _overlayGatedFeature: true as const,
        feature: 'web_search' as const,
        message: 'Web page fetching is available on a paid plan.',
      }),
    }),

  }
}
