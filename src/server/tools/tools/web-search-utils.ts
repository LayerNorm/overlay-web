import { searchResults } from './web-search-entity'

export function mergeSearchOutputs(queries: string[], outputs: unknown[]): Record<string, unknown> {
  const seenUrls = new Set<string>()
  const results: Record<string, unknown>[] = []
  const answers: string[] = []
  for (let i = 0; i < outputs.length; i++) {
    for (const result of searchResults(outputs[i])) {
      const url = typeof result.url === 'string' ? result.url : ''
      if (url && seenUrls.has(url)) continue
      if (url) seenUrls.add(url)
      results.push(queries.length > 1 ? { ...result, query: queries[i] } : result)
    }
    const answer = outputs[i] && typeof outputs[i] === 'object'
      ? (outputs[i] as Record<string, unknown>).answer
      : undefined
    if (typeof answer === 'string' && answer.trim()) answers.push(answer)
  }
  const out: Record<string, unknown> = { results }
  if (answers.length) out.answers = answers
  if (queries.length > 1) out.queries = queries
  return out
}

export function capFetchText(output: unknown, maxCharsPerPage: number): unknown {
  if (typeof output !== 'object' || output === null || !Array.isArray((output as Record<string, unknown>).results)) {
    return output
  }
  const results = (output as { results: Record<string, unknown>[] }).results.map((result) => {
    if (typeof result.text === 'string' && result.text.length > maxCharsPerPage) {
      return { ...result, text: result.text.slice(0, maxCharsPerPage), truncated: true }
    }
    return result
  })
  return { ...(output as Record<string, unknown>), results }
}

// Tavily's `country` takes an English country name, not an ISO code.
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })
export function tavilyCountryName(alpha2: string | undefined): string | undefined {
  if (!alpha2) return undefined
  const code = alpha2.toUpperCase()
  try {
    const name = regionNames.of(code)
    // of() echoes the input back for well-formed but unknown codes — omit those.
    return name && name !== code ? name : undefined
  } catch (_error) {
    return undefined
  }
}

export function splitDomainFilter(filter: string[] | undefined): { include: string[]; exclude: string[] } {
  const include: string[] = []
  const exclude: string[] = []
  for (const entry of filter ?? []) {
    if (entry.startsWith('-')) exclude.push(entry.slice(1))
    else include.push(entry)
  }
  return { include, exclude }
}

export function compactObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => (
      Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null
    )),
  )
}
