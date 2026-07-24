/**
 * Web Search Service
 *
 * Provides web search functionality for tool-based search in chat.
 * Uses DuckDuckGo Instant Answer API (free, no API key required).
 */

import { tool } from 'ai'
import { z } from 'zod'

interface SearchResult {
  title: string
  snippet: string
  url: string
}

interface DDGResponse {
  Abstract?: string
  AbstractText?: string
  AbstractSource?: string
  AbstractURL?: string
  RelatedTopics?: Array<{
    Text?: string
    FirstURL?: string
    Result?: string
  }>
}

/**
 * Perform a web search using DuckDuckGo Instant Answer API
 */
async function performWebSearch(query: string, maxResults = 5): Promise<SearchResult[]> {
  try {
    const encodedQuery = encodeURIComponent(query)
    const url = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Overlay/1.0'
      }
    })

    if (!response.ok) {
      console.error(`[WebSearch] DuckDuckGo API error: ${response.status}`)
      return []
    }

    const data = (await response.json()) as DDGResponse
    const results: SearchResult[] = []

    // Add abstract if available
    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.AbstractSource || 'Summary',
        snippet: data.AbstractText,
        url: data.AbstractURL
      })
    }

    // Add related topics
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics) {
        if (results.length >= maxResults) break
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.split(' - ')[0] || 'Related',
            snippet: topic.Text,
            url: topic.FirstURL
          })
        }
      }
    }

    console.log(`[WebSearch] Found ${results.length} results for: ${query}`)
    return results
  } catch (error) {
    console.error('[WebSearch] Search error:', error)
    return []
  }
}

/**
 * Create the web search tool for use with AI SDK
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createWebSearchTool() {
  return tool({
    description:
      'Search the web for current information. Use this when you need up-to-date information, facts, or to answer questions about recent events.',
    inputSchema: z.object({
      query: z.string().describe('The search query')
    }),
    execute: async ({ query }) => {
      console.log(`[WebSearch] Searching for: ${query}`)
      const results = await performWebSearch(query)

      if (results.length === 0) {
        return JSON.stringify({
          success: false,
          message: 'No search results found. Try rephrasing your query.'
        })
      }

      return JSON.stringify({
        success: true,
        query,
        results: results.map((r) => ({
          title: r.title,
          snippet: r.snippet.slice(0, 300),
          url: r.url
        }))
      })
    }
  })
}

/**
 * Get search tools object for use with generateText/streamText
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function getSearchTools() {
  return {
    web_search: createWebSearchTool()
  }
}
