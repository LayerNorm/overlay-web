/**
 * Skill discovery for self-verticalization: ranking a workspace's skills against a task, loading a skill in
 * layers, and searching public skill registries (skills.sh, skillmd.com) for skills other people have written.
 *
 * Pure apart from `searchSkillRegistries`, which only calls fixed public hosts.
 */

import { BUILTIN_SKILLS } from './builtin-skills'

export type DiscoverableSkill = {
  _id: string
  name: string
  description?: string
  instructions: string
  enabled?: boolean
  domain?: string
  kind?: 'skill' | 'domain_map'
  triggers?: string[]
  origin?: 'user' | 'agent' | 'registry' | 'builtin'
  version?: number
}

export type RankedSkill = {
  id: string
  name: string
  description: string
  domain?: string
  kind?: 'skill' | 'domain_map'
  origin?: DiscoverableSkill['origin']
  /** 0 to 1. Below about 0.3 the skill is a weak fit; consider self-verticalizing instead. */
  score: number
}

/** Below this, find_skills tells the agent no adequate skill exists. */
export const WEAK_SKILL_FIT = 0.3

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'i', 'in', 'into', 'is', 'it', 'me', 'my',
  'of', 'on', 'or', 'our', 'that', 'the', 'this', 'to', 'use', 'using', 'we', 'when', 'with', 'you', 'your', 'make',
  'want', 'need', 'do', 'can', 'should', 'very', 'good', 'help',
])

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9+#.-]*/g) ?? [])
    .map(token => token.replace(/[.-]+$/, ''))
    .filter(token => token.length > 1 && !STOPWORDS.has(token))
}

/** Crude stem so "videos", "editing" and "edit" meet. Good enough for ranking a few hundred skills. */
function stem(token: string): string {
  const stemmed = token.replace(/(ing|ers|er|ies|es|s|ed)$/, '')
  return stemmed.length >= 2 ? stemmed : token
}

function stems(text: string): Set<string> {
  return new Set(tokenize(text).map(stem))
}

function overlap(query: Set<string>, field: Set<string>): number {
  if (query.size === 0 || field.size === 0) return 0
  let hits = 0
  for (const token of query) if (field.has(token)) hits += 1
  return hits / query.size
}

/**
 * Ranks skills for a task. Name, triggers and domain weigh most, then description, then the body. With a domain
 * filter, that domain's map ranks first so an agent entering a domain reads the map before its skills.
 */
export function rankSkills(skills: DiscoverableSkill[], query: string, options: { domain?: string; limit?: number } = {}): RankedSkill[] {
  const q = stems(query)
  const domainFilter = options.domain?.trim().toLowerCase()
  const ranked: RankedSkill[] = []
  for (const skill of skills) {
    if (skill.enabled === false) continue
    if (domainFilter && (skill.domain ?? '').toLowerCase() !== domainFilter) continue
    const nameScore = overlap(q, stems(skill.name.replace(/[-_]/g, ' ')))
    const triggerScore = overlap(q, stems((skill.triggers ?? []).join(' ')))
    const domainScore = overlap(q, stems((skill.domain ?? '').replace(/[-_]/g, ' ')))
    const descriptionScore = overlap(q, stems(skill.description ?? ''))
    const bodyScore = overlap(q, stems(skill.instructions.slice(0, 4_000)))
    let score = Math.max(nameScore, triggerScore) * 0.4 + domainScore * 0.15 + descriptionScore * 0.3 + bodyScore * 0.15
    if (q.size === 0) score = domainFilter ? 0.5 : 0
    if (domainFilter && skill.kind === 'domain_map') score += 0.1
    if (score <= 0) continue
    ranked.push({
      id: skill._id,
      name: skill.name,
      description: skill.description ?? '',
      ...(skill.domain ? { domain: skill.domain } : {}),
      ...(skill.kind ? { kind: skill.kind } : {}),
      ...(skill.origin ? { origin: skill.origin } : {}),
      score: Math.min(1, Math.round(score * 100) / 100),
    })
  }
  ranked.sort((a, b) => {
    // With a domain selected, its map always comes first so the agent reads the field map before its skills.
    if (domainFilter) {
      const mapOrder = Number(b.kind === 'domain_map') - Number(a.kind === 'domain_map')
      if (mapOrder !== 0) return mapOrder
    }
    return b.score - a.score || a.name.localeCompare(b.name)
  })
  return ranked.slice(0, Math.min(Math.max(options.limit ?? 5, 1), 20))
}

/** Groups skills into domains (folders) with counts and whether each has a map. */
export function summarizeDomains(skills: DiscoverableSkill[]): Array<{ domain: string; skillCount: number; hasMap: boolean }> {
  const domains = new Map<string, { skillCount: number; hasMap: boolean }>()
  for (const skill of skills) {
    if (!skill.domain || skill.enabled === false) continue
    const entry = domains.get(skill.domain) ?? { skillCount: 0, hasMap: false }
    if (skill.kind === 'domain_map') entry.hasMap = true
    else entry.skillCount += 1
    domains.set(skill.domain, entry)
  }
  return [...domains.entries()].map(([domain, entry]) => ({ domain, ...entry })).sort((a, b) => a.domain.localeCompare(b.domain))
}

/** Markdown headings (## to ####) of a skill, for loading in layers. */
export function skillOutline(instructions: string): string[] {
  return instructions.split('\n').filter(line => /^#{2,4}\s+\S/.test(line)).map(line => line.replace(/^#+\s+/, '').trim())
}

/**
 * One section of a skill: the heading and everything under it, up to the next heading of the same or higher
 * level. Matched case-insensitively. Null when absent.
 */
export function extractSkillSection(instructions: string, heading: string): string | null {
  const lines = instructions.split('\n')
  // Lines inside fenced code blocks (e.g. shell comments starting with #) are not headings.
  const inFence: boolean[] = []
  let fence: string | null = null
  for (const line of lines) {
    const marker = line.trim().match(/^(`{3,}|~{3,})/)?.[1]
    if (marker && (fence === null || marker.startsWith(fence))) {
      inFence.push(true)
      fence = fence === null ? marker : null
      continue
    }
    inFence.push(fence !== null)
  }
  const wanted = heading.trim().toLowerCase().replace(/^#+\s*/, '')
  const start = lines.findIndex((line, i) => !inFence[i] && /^#{1,6}\s+/.test(line) && line.replace(/^#+\s+/, '').trim().toLowerCase() === wanted)
  if (start < 0) return null
  const level = lines[start].match(/^#+/)?.[0].length ?? 2
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (inFence[i]) continue
    const match = lines[i].match(/^(#+)\s+/)
    if (match && match[1].length <= level) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join('\n').trim()
}

export const SKILL_LOAD_MAX_CHARS = 30_000

export function builtinSkillsAsDiscoverable(): DiscoverableSkill[] {
  return BUILTIN_SKILLS.map(skill => ({
    _id: skill.id,
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    domain: skill.domain,
    triggers: skill.triggers,
    origin: 'builtin' as const,
    version: skill.version,
  }))
}

// ---------------------------------------------------------------------------------------------------------------
// Public skill registries
// ---------------------------------------------------------------------------------------------------------------

export type RegistryId = 'skills.sh' | 'skillmd.com'
export const SKILL_REGISTRIES: readonly RegistryId[] = ['skills.sh', 'skillmd.com']

export type RegistrySkill = {
  registry: RegistryId
  name: string
  /** Stable registry identifier, e.g. `owner/repo/skill` on skills.sh or `owner/skill` on skillmd.com. */
  id: string
  description?: string
  /** Popularity signal: installs on skills.sh, ratings on skillmd.com. */
  installs?: number
  rating?: number
  verified?: boolean
  /** Human page for review. */
  url: string
  /** Where the SKILL.md text can be fetched with web_fetch, when the registry exposes it. */
  rawUrl?: string
  /** For skills.sh: the GitHub repository the skill lives in. */
  sourceRepo?: string
}

export type RegistryFetch = (
  input: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/

/** `owner/repo/skill` style identifiers only: no empty, `.` or `..` segments, nothing that could leave the path. */
function isSafeRegistryPath(value: string): boolean {
  return value.split('/').every(segment => SAFE_SEGMENT.test(segment) && segment !== '.' && segment !== '..')
}

export function normalizeSkillsShResults(payload: unknown): RegistrySkill[] {
  const skills = asRecord(payload).skills
  if (!Array.isArray(skills)) return []
  return skills.flatMap((raw): RegistrySkill[] => {
    const row = asRecord(raw)
    const id = str(row.id)
    const source = str(row.source)
    const skillId = str(row.skillId)
    if (!id || !source || !skillId || !isSafeRegistryPath(source) || !isSafeRegistryPath(skillId)) return []
    const installs = num(row.installs)
    return [{
      registry: 'skills.sh',
      id,
      name: str(row.name) ?? skillId,
      ...(installs !== undefined ? { installs } : {}),
      url: `https://skills.sh/${source}/${skillId}`,
      sourceRepo: `https://github.com/${source}`,
    }]
  })
}

export function normalizeSkillMdResults(payload: unknown): RegistrySkill[] {
  const items = asRecord(payload).items
  if (!Array.isArray(items)) return []
  return items.flatMap((raw): RegistrySkill[] => {
    const row = asRecord(raw)
    const slug = str(row.slug)
    if (!slug || !isSafeRegistryPath(slug)) return []
    const rawUrl = str(row.raw_url)
    const description = str(row.description)
    const rating = num(row.avg_rating)
    return [{
      registry: 'skillmd.com',
      id: slug,
      name: str(row.title) ?? slug,
      ...(description ? { description } : {}),
      ...(rating ? { rating } : {}),
      verified: row.verified === true,
      url: `https://skillmd.com/skills/${slug}`,
      ...(rawUrl?.startsWith('https://api.skillmd.com/') ? { rawUrl } : {}),
    }]
  })
}

const REGISTRY_TIMEOUT_MS = 8_000

/**
 * Searches public skill registries in parallel. Only fixed public hosts are called and the query is the only
 * input, so this cannot be pointed at internal addresses. One registry failing does not fail the search.
 */
export async function searchSkillRegistries(
  query: string,
  options: { registries?: readonly RegistryId[]; limit?: number; fetchImpl?: RegistryFetch } = {},
): Promise<{ results: RegistrySkill[]; errors: Array<{ registry: RegistryId; error: string }> }> {
  const limit = Math.min(Math.max(options.limit ?? 8, 1), 20)
  const registries = (options.registries?.length ? options.registries : SKILL_REGISTRIES).filter(r => SKILL_REGISTRIES.includes(r))
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as RegistryFetch)
  const q = encodeURIComponent(query.trim().slice(0, 200))
  const settled = await Promise.all(registries.map(async (registry): Promise<{ registry: RegistryId; rows?: RegistrySkill[]; error?: string }> => {
    const url = registry === 'skills.sh'
      ? `https://skills.sh/api/search?q=${q}&limit=${limit}`
      : `https://api.skillmd.com/v1/search?q=${q}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS)
    try {
      const res = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json' } })
      if (!res.ok) return { registry, error: `HTTP ${res.status}` }
      const payload = await res.json()
      const rows = registry === 'skills.sh' ? normalizeSkillsShResults(payload) : normalizeSkillMdResults(payload)
      return { registry, rows: rows.slice(0, limit) }
    } catch (err) {
      return { registry, error: err instanceof Error ? err.message : 'Request failed' }
    } finally {
      clearTimeout(timer)
    }
  }))
  const results: RegistrySkill[] = []
  const errors: Array<{ registry: RegistryId; error: string }> = []
  for (const entry of settled) {
    if (entry.rows) results.push(...entry.rows)
    else if (entry.error) errors.push({ registry: entry.registry, error: entry.error })
  }
  return { results, errors }
}
