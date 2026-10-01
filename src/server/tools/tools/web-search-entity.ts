import 'server-only'

export type SearchResultRecord = Record<string, unknown>

export type ExactEntityFallbackPlan = {
  label: string
  identityTerms: string[]
  objective: string
  searchQueries: string[]
}

const ENTITY_HONORIFICS = new Set([
  'dr',
  'doctor',
  'prof',
  'professor',
  'mr',
  'mrs',
  'ms',
  'sir',
])

const ENTITY_QUERY_STOP_WORDS = new Set([
  ...ENTITY_HONORIFICS,
  'about',
  'find',
  'information',
  'is',
  'look',
  'on',
  'search',
  'tell',
  'the',
  'up',
  'who',
])

export function buildExactEntityFallbackPlan(
  query: string | string[],
  country?: string,
): ExactEntityFallbackPlan | null {
  const candidates = Array.isArray(query) ? query : [query]
  for (const candidate of candidates) {
    const trimmed = candidate.trim()
    if (!trimmed) continue
    const hasEntityPrefix = /^(?:who\s+is|who's|tell\s+me\s+about|look\s+up|find\s+(?:information\s+)?(?:about|on)|search\s+for)\b/i.test(trimmed)
    const hasHonorific = /^(?:dr|doctor|prof|professor|mr|mrs|ms|sir)\.?\s+/i.test(trimmed)
    const isQuoted = /^["“][^"”]+["”]$/.test(trimmed)
    if (!hasEntityPrefix && !hasHonorific && !isQuoted) continue

    const label = trimmed
      .replace(/^(?:who\s+is|who's|tell\s+me\s+about|look\s+up|find\s+(?:information\s+)?(?:about|on)|search\s+for)\s+/i, '')
      .replace(/^["“]|["”]$/g, '')
      .replace(/[?.!,;:]+$/g, '')
      .trim()
    const identityTerms = normalizedSearchTerms(label)
      .filter((term) => !ENTITY_QUERY_STOP_WORDS.has(term))
    if (identityTerms.length < 2 || identityTerms.length > 6) continue

    const countryHint = country ? ` Prefer sources relevant to country code ${country}.` : ''
    return {
      label,
      identityTerms,
      objective:
        `Identify the exact person or entity named "${label}" and return authoritative profile details. ` +
        `Exclude results that only share part of the name.${countryHint}`,
      searchQueries: [`"${label}"`, label],
    }
  }
  return null
}

export function hasExactEntityMatch(
  output: unknown,
  identityTerms: string[],
): boolean {
  return searchResults(output).some((result) =>
    resultMatchesIdentity(result, identityTerms),
  )
}

export function filterExactEntityResults(
  output: unknown,
  plan: ExactEntityFallbackPlan,
): unknown {
  if (!isRecord(output)) return output
  const seenUrls = new Set<string>()
  const results = searchResults(output)
    .filter((result) => resultMatchesIdentity(result, plan.identityTerms))
    .filter((result) => {
      const url = typeof result.url === 'string' ? result.url : ''
      if (!url || seenUrls.has(url)) return false
      seenUrls.add(url)
      return true
    })
  if (results.length === 0) return output

  return {
    ...output,
    results,
    search_strategy: 'exact_entity_filter',
    search_note:
      `Results were limited to exact title or URL matches for "${plan.label}". ` +
      'Treat the first detailed profile as the primary identity. Do not infer separate people solely from conflicting specialties in sparse directories unless distinct identifiers support that conclusion.',
  }
}

export function mergeExactEntityFallbackResults(
  primaryOutput: unknown,
  fallbackOutput: unknown,
  plan: ExactEntityFallbackPlan,
): unknown {
  if (!isRecord(primaryOutput) || !isRecord(fallbackOutput)) return primaryOutput
  const exactResults = [
    ...searchResults(fallbackOutput)
      .filter((result) => resultMatchesIdentity(result, plan.identityTerms))
      .map(normalizeFallbackResult),
    ...searchResults(primaryOutput)
      .filter((result) => resultMatchesIdentity(result, plan.identityTerms)),
  ]
  if (exactResults.length === 0) return primaryOutput

  const seenUrls = new Set<string>()
  const results = exactResults.filter((result) => {
    const url = typeof result.url === 'string' ? result.url : ''
    if (!url || seenUrls.has(url)) return false
    seenUrls.add(url)
    return true
  })

  return {
    ...primaryOutput,
    results,
    search_strategy: 'exact_entity_deep_augmentation',
    search_note:
      `Exact matches for "${plan.label}" were enriched with deeper exact-entity search results. ` +
      'Treat the first detailed profile as the primary identity. Do not infer separate people solely from conflicting specialties in sparse directories unless distinct identifiers support that conclusion.',
  }
}

export function normalizedSearchTerms(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function searchResults(output: unknown): SearchResultRecord[] {
  if (!isRecord(output) || !Array.isArray(output.results)) return []
  return output.results.filter(isRecord)
}

function resultMatchesIdentity(
  result: SearchResultRecord,
  identityTerms: string[],
): boolean {
  const identitySurface = normalizedSearchTerms([
    result.title,
    result.url,
  ].filter((value): value is string => typeof value === 'string').join(' '))
  const identitySurfaceTerms = new Set(identitySurface)
  return identityTerms.every((term) => identitySurfaceTerms.has(term))
}

function normalizeFallbackResult(result: SearchResultRecord): SearchResultRecord {
  const excerpts = Array.isArray(result.excerpts)
    ? result.excerpts.filter((value): value is string => typeof value === 'string')
    : []
  const excerpt = typeof result.excerpt === 'string' ? result.excerpt : ''
  const snippet = typeof result.snippet === 'string' && result.snippet.trim()
    ? result.snippet
    : excerpts.join('\n\n') || excerpt
  const date = typeof result.date === 'string'
    ? result.date
    : typeof result.publish_date === 'string'
      ? result.publish_date
      : typeof result.publishedDate === 'string'
        ? result.publishedDate
        : undefined

  return {
    ...result,
    snippet,
    ...(date ? { date } : {}),
  }
}
