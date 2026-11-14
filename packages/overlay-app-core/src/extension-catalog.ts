import type { McpAuthType, McpTransport } from './contracts'

/**
 * Curated Browse sections for the Extensions catalog. A section lists catalog keys (connector slugs, MCP and skill
 * template ids) in display order; anything not listed falls into a trailing "All" section.
 */
export interface ExtensionCatalogCategory {
  id: string
  title: string
  keys: readonly string[]
}

export interface ExtensionCatalogSection<Item> {
  id: string
  title: string
  items: Item[]
}

export const EXTENSION_CATALOG_ALL_SECTION_ID = 'all'

export const CONNECTOR_CATEGORIES: readonly ExtensionCatalogCategory[] = [
  { id: 'popular', title: 'Popular', keys: ['gmail', 'googlecalendar', 'github', 'slack', 'notion', 'linear', 'googledrive', 'outlook'] },
  { id: 'new', title: 'New & Noteworthy', keys: ['granola', 'attio', 'sentry', 'figma', 'calendly', 'zoom'] },
  { id: 'sales', title: 'Sales & CRM', keys: ['hubspot', 'salesforce', 'affinity', 'apollo', 'pipedrive', 'close', 'attio'] },
  { id: 'business', title: 'Small Business', keys: ['stripe', 'quickbooks', 'shopify', 'dropbox', 'xero', 'square'] },
  { id: 'projects', title: 'Project Management', keys: ['asana', 'jira', 'airtable', 'clickup', 'monday', 'trello'] },
  { id: 'developer', title: 'Developer Tools', keys: ['github', 'gitlab', 'sentry', 'linear', 'vercel', 'supabase'] },
]

/** A well-known remote MCP server. Adding one opens the normal Add server dialog filled in with these values. */
export interface McpCatalogEntry {
  id: string
  name: string
  description: string
  url: string
  transport: McpTransport
  authType: McpAuthType
  logoUrl?: string
  logoDarkUrl?: string
}

const LOGO = '/assets/svg/landing'

export const MCP_CATALOG: readonly McpCatalogEntry[] = [
  { id: 'github', name: 'GitHub', description: 'Repositories, issues and pull requests', url: 'https://api.githubcopilot.com/mcp/', transport: 'streamable-http', authType: 'oauth', logoUrl: `${LOGO}/github.svg`, logoDarkUrl: `${LOGO}/github_dark.svg` },
  { id: 'linear', name: 'Linear', description: 'Issues, projects and cycles', url: 'https://mcp.linear.app/mcp', transport: 'streamable-http', authType: 'oauth', logoUrl: `${LOGO}/linear.svg` },
  { id: 'sentry', name: 'Sentry', description: 'Debug production errors', url: 'https://mcp.sentry.dev/mcp', transport: 'streamable-http', authType: 'oauth', logoUrl: `${LOGO}/sentry.svg` },
  { id: 'notion', name: 'Notion', description: 'Search and edit workspace pages', url: 'https://mcp.notion.com/mcp', transport: 'streamable-http', authType: 'oauth', logoUrl: `${LOGO}/notion.svg` },
  { id: 'context7', name: 'Context7', description: 'Up-to-date library documentation', url: 'https://mcp.context7.com/mcp', transport: 'streamable-http', authType: 'none' },
  { id: 'deepwiki', name: 'DeepWiki', description: 'Ask questions about public repositories', url: 'https://mcp.deepwiki.com/mcp', transport: 'streamable-http', authType: 'none' },
  { id: 'vercel', name: 'Vercel', description: 'Deployments, logs and projects', url: 'https://mcp.vercel.com', transport: 'streamable-http', authType: 'oauth' },
  { id: 'supabase', name: 'Supabase', description: 'Databases and edge functions', url: 'https://mcp.supabase.com/mcp', transport: 'streamable-http', authType: 'oauth' },
  { id: 'stripe', name: 'Stripe', description: 'Payments, customers and invoices', url: 'https://mcp.stripe.com', transport: 'streamable-http', authType: 'oauth' },
  { id: 'huggingface', name: 'Hugging Face', description: 'Models, datasets and Spaces', url: 'https://huggingface.co/mcp', transport: 'streamable-http', authType: 'none' },
]

export const MCP_CATEGORIES: readonly ExtensionCatalogCategory[] = [
  { id: 'popular', title: 'Popular', keys: ['github', 'linear', 'sentry', 'notion', 'context7', 'deepwiki'] },
  { id: 'developer', title: 'Developer Tools', keys: ['github', 'vercel', 'supabase', 'sentry', 'context7', 'huggingface'] },
]

/** Lucide glyph names the React layer maps to icons; app-core stays free of UI imports. */
export type SkillTemplateIcon = 'pen' | 'mail' | 'notes' | 'chart' | 'languages' | 'search' | 'code' | 'list'

/** A ready-made skill. Adding one opens the normal New skill dialog filled in with these values. */
export interface SkillTemplate {
  id: string
  name: string
  description: string
  instructions: string
  icon: SkillTemplateIcon
}

export const SKILL_TEMPLATES: readonly SkillTemplate[] = [
  {
    id: 'email-drafts', name: 'Email drafts', description: 'Concise replies that match your tone', icon: 'mail',
    instructions: 'When drafting email, write short, plain replies. Lead with the answer or the ask, keep to one idea per paragraph, and match the tone of the thread. End with a clear next step. Do not add filler greetings or sign-offs unless the thread uses them.',
  },
  {
    id: 'meeting-notes', name: 'Meeting notes', description: 'Decisions, owners and next steps', icon: 'notes',
    instructions: 'Turn meeting transcripts or rough notes into a short summary with three sections: Decisions, Action items (each with an owner and a due date when one was mentioned) and Open questions. Leave out small talk. Quote numbers and dates exactly.',
  },
  {
    id: 'research-brief', name: 'Research brief', description: 'Sourced answers with key findings first', icon: 'search',
    instructions: 'When researching a question, start with a two-sentence answer, then list the key findings with a source for each. Note where sources disagree and how confident you are. Prefer primary sources and recent data.',
  },
  {
    id: 'brand-voice', name: 'Brand voice', description: 'Keep copy in your house style', icon: 'pen',
    instructions: 'Write in a clear, warm and direct voice. Use short sentences and everyday words, active voice and sentence case headings. Avoid jargon, hype and exclamation marks. Edit this skill with your own style rules and examples.',
  },
  {
    id: 'metrics-review', name: 'Metrics review', description: 'Summarize dashboards each week', icon: 'chart',
    instructions: 'When reviewing metrics, report what changed since the last period, by how much and the most likely reason. Call out anything outside its normal range first. Keep it to a short list and say which numbers you could not verify.',
  },
  {
    id: 'translation', name: 'Translation', description: 'Translate and localize text', icon: 'languages',
    instructions: 'Translate text naturally rather than word for word. Keep names, product terms, formatting and placeholders unchanged. Adapt dates, numbers and units to the target locale, and flag phrases that have no good equivalent.',
  },
  {
    id: 'code-review', name: 'Code review', description: 'Find bugs before style nits', icon: 'code',
    instructions: 'When reviewing code, look for correctness bugs, security problems and missing error handling first, then simplifications. Point to the exact lines, explain the impact and suggest a fix. Skip purely cosmetic comments.',
  },
  {
    id: 'task-planning', name: 'Task planning', description: 'Break work into clear next steps', icon: 'list',
    instructions: 'When asked to plan work, break it into small ordered steps that each have a clear finish line. Mark dependencies and the riskiest step, and suggest what to do first today.',
  },
]

export const SKILL_CATEGORIES: readonly ExtensionCatalogCategory[] = [
  { id: 'popular', title: 'Popular', keys: ['email-drafts', 'meeting-notes', 'research-brief', 'task-planning'] },
  { id: 'writing', title: 'Writing', keys: ['brand-voice', 'email-drafts', 'translation', 'meeting-notes'] },
  { id: 'work', title: 'Work', keys: ['metrics-review', 'code-review', 'task-planning', 'research-brief'] },
]

/**
 * Groups catalog items into the curated sections (in their listed order, skipping keys not present) followed by an
 * "All" section with every item no curated section lists. Empty sections are left out.
 */
export function groupExtensionCatalog<Item>(
  items: readonly Item[],
  categories: readonly ExtensionCatalogCategory[],
  keyOf: (item: Item) => string,
  allTitle = 'All',
): ExtensionCatalogSection<Item>[] {
  const byKey = new Map<string, Item>()
  for (const item of items) if (!byKey.has(keyOf(item))) byKey.set(keyOf(item), item)
  const curated = new Set<string>()
  const sections: ExtensionCatalogSection<Item>[] = []
  for (const category of categories) {
    const sectionItems = category.keys.flatMap((key) => {
      curated.add(key)
      const item = byKey.get(key)
      return item ? [item] : []
    })
    if (sectionItems.length) sections.push({ id: category.id, title: category.title, items: sectionItems })
  }
  const rest = [...byKey.entries()].filter(([key]) => !curated.has(key)).map(([, item]) => item)
  if (rest.length) sections.push({ id: EXTENSION_CATALOG_ALL_SECTION_ID, title: allTitle, items: rest })
  return sections
}

/** Compares MCP server URLs ignoring case of the host, a trailing slash and surrounding space. */
export function normalizeMcpServerUrl(url: string): string {
  const trimmed = url.trim()
  try {
    const parsed = new URL(trimmed)
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`
  } catch {
    return trimmed.replace(/\/+$/, '').toLowerCase()
  }
}

/** Case-insensitive match on any of the given fields; an empty query matches everything. */
export function matchesExtensionQuery(query: string, ...fields: ReadonlyArray<string | null | undefined>): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return fields.some((field) => field?.toLowerCase().includes(q))
}
