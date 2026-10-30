import { z } from 'zod/v3'

export const webSearchInputSchema = z.object({
  query: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1).max(5)])
    .describe('The search query, or up to 5 queries to batch'),
  maxResults: z.number().int().min(1).max(20).optional(),
  searchDomainFilter: z
    .array(z.string().min(1))
    .max(20)
    .optional()
    .describe("Allowlist e.g. arxiv.org — or '-reddit.com' to exclude (max 20)"),
  searchRecencyFilter: z
    .enum(['day', 'week', 'month', 'year'])
    .optional()
    .describe('Relative time window. Use day/week for news'),
  searchAfterDate: z.string().optional().describe('YYYY-MM-DD'),
  searchBeforeDate: z.string().optional().describe('YYYY-MM-DD'),
  country: z
    .string()
    .length(2)
    .optional()
    .describe("ISO 3166-1 alpha-2 (e.g. 'US')"),
})

export const deepSearchInputSchema = z.object({
  objective: z
    .string()
    .min(1)
    .max(5000)
    .describe(
      'Natural-language research goal; for academic work say so and name domains (e.g. arxiv, PubMed).',
    ),
  searchQueries: z
    .array(z.string().min(1).max(200))
    .max(6)
    .optional()
    .describe('Short keyword queries (2-3 work best) to supplement the objective'),
  effort: z
    .enum(['fast', 'standard', 'deep'])
    .optional()
    .describe('Retrieval thoroughness; default deep'),
  maxResults: z.number().int().min(1).max(20).optional(),
  includeDomains: z.array(z.string().min(1)).optional(),
  excludeDomains: z.array(z.string().min(1)).optional(),
  afterDate: z
    .string()
    .optional()
    .describe('YYYY-MM-DD; only include sources published after this date'),
  maxCharsPerResult: z.number().int().min(200).max(20_000).optional(),
  maxCharsTotal: z.number().int().min(2000).max(200_000).optional(),
  maxAgeSeconds: z.number().int().min(600).optional(),
})

export const webFetchInputSchema = z.object({
  urls: z
    .array(z.string().url())
    .min(1)
    .max(10)
    .describe('One or more URLs to fetch (up to 10)'),
  format: z.enum(['markdown', 'html', 'json']).optional(),
  maxCharsPerPage: z.number().int().min(500).max(100_000).optional(),
  ttl: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Cache freshness in seconds; 0 forces a live fetch'),
  includeSelectors: z.array(z.string().min(1)).max(20).optional(),
  excludeSelectors: z.array(z.string().min(1)).max(20).optional(),
})

export type WebSearchInput = z.infer<typeof webSearchInputSchema>
export type DeepSearchInput = z.infer<typeof deepSearchInputSchema>
export type WebFetchInput = z.infer<typeof webFetchInputSchema>
