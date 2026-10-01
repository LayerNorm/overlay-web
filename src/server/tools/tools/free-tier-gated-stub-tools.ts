import 'server-only'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import {
  deepSearchInputSchema,
  webFetchInputSchema,
  webSearchInputSchema,
} from '@/server/tools/tools/web-search'

const interactiveBrowserInputSchema = z.object({
  task: z.string().describe('What to do in the browser — natural language'),
  model: z.enum(['bu-mini', 'bu-max']).optional(),
  sessionId: z.string().optional().describe('Reuse an existing browser session'),
  keepAlive: z.boolean().optional().describe('Keep session alive after task for follow-ups'),
  proxyCountryCode: z.string().optional().describe('2-letter country code for residential proxy'),
})

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
    interactive_browser_session: tool({
      description:
        'Remote AI-controlled browser session for interactive web tasks. On the free plan this tool only ' +
        'registers the need for browser automation. Call it when the task requires driving a real browser ' +
        '(not for simple web lookup — use web_search or deep_search first for research).',
      inputSchema: interactiveBrowserInputSchema,
      execute: async () => ({
        _overlayGatedFeature: true as const,
        feature: 'remote_browser' as const,
        message: 'Remote browser sessions are available on a paid plan.',
      }),
    }),
  }
}
