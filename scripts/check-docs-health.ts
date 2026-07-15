import { access, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatOverlayConfigError,
  getRedactedOverlayRuntimeConfigSummary,
  loadOverlayConfig,
} from '../src/server/config/loadOverlayConfig.ts'
import {
  OverlayAnalyticsProviderSchema,
  OverlayAuthProviderSchema,
  OverlayBillingProviderSchema,
  OverlayBrowserProviderSchema,
  OverlayDatabaseProviderSchema,
  OverlayEmbeddingsProviderSchema,
  OverlayErrorReportingProviderSchema,
  OverlayIntegrationsProviderSchema,
  OverlayLlmGatewayProviderSchema,
  OverlayRateLimitProviderSchema,
  OverlaySandboxProviderSchema,
  OverlaySecretsProviderSchema,
  OverlayStorageProviderSchema,
  OverlayVectorSearchProviderSchema,
  OverlayWebSearchProviderSchema,
} from '../src/shared/config/overlayConfigSchema.ts'
import { webApiBoundaryDefinitions } from '../src/shared/schemas/api-boundary.ts'
import type { OverlayRuntimeConfigInput } from '../src/shared/config/overlayConfigSchema.ts'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const docsDir = path.join(root, 'docs')
const configExamplesDir = path.join(docsDir, 'config')
const openApiFile = path.join(docsDir, 'openapi/overlay-web.openapi.json')

const allowedDocsEntries = new Set([
  'README.md',
  'api-reference',
  'changelog.mdx',
  'config',
  'configure',
  'deploy-operate',
  'develop',
  'docs.json',
  'help',
  'introduction.mdx',
  'legal',
  'openapi',
  'snippets',
  'start',
])

const disallowedExamplePatterns = [
  { label: 'Stripe secret key', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_]+/i },
  { label: 'Stripe webhook secret', pattern: /\bwhsec_[A-Za-z0-9_]+/i },
  { label: 'Overlay API key secret', pattern: /\bovl_sk_[A-Za-z0-9_]+/i },
  { label: 'known production Convex deployment slug', pattern: /prod:colorful/i },
  { label: 'real-looking Convex cloud URL', pattern: /https:\/\/[a-z0-9-]+\.convex\.cloud/i },
] as const

const stalePublicPatterns = [
  { label: 'MinIO should not appear in public docs', pattern: /\bminio\b/i },
  { label: 'old docs-site wording', pattern: /\bdocs-site\b/i },
  { label: 'removed design.md link', pattern: /docs\/design\.md|\.\/design\.md/i },
  { label: 'removed docs sync workflow', pattern: /docs:sync|sync-docs-to-site/i },
  { label: 'stale public Phase 6 framing', pattern: /\bPhase 6\b/ },
  {
    label: 'private numbered AWS rehearsal reference',
    pattern: /aws-rehearsal-\d|^title:\s*["']?AWS Rehearsal\s+\d/im,
  },
  { label: 'internal phase-titled page', pattern: /^title:\s*["']?P\d/im },
] as const

type DocsJsonNavigation = {
  navigation?: {
    groups?: unknown[]
  }
}

type OpenApiSpec = {
  paths?: Record<string, Record<string, { operationId?: string; summary?: string }>>
}

async function main() {
  const failures: string[] = []

  await checkDocsTopLevelShape(failures)
  const navPages = await checkNavigationTargets(failures)
  await checkMdxOrphans(navPages, failures)
  await checkLocalLinks(failures)
  await checkStalePublicTerms(failures)
  await checkConfigExamples(failures)
  await checkOpenApiOutput(failures)
  await checkProviderDocs(failures)

  if (failures.length > 0) {
    console.error('FAIL docs health:')
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exit(1)
  }

  console.log('OK docs health')
}

async function checkDocsTopLevelShape(failures: string[]) {
  const entries = await readdir(docsDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (!allowedDocsEntries.has(entry.name)) {
      failures.push(`docs/${entry.name} is not part of the public docs shape`)
    }
  }
}

async function checkNavigationTargets(failures: string[]) {
  const config = JSON.parse(await readFile(path.join(docsDir, 'docs.json'), 'utf8')) as DocsJsonNavigation
  const pages = new Set<string>()
  collectNavPages(config.navigation?.groups ?? [], pages)

  for (const page of pages) {
    if (page.endsWith('/*')) continue
    const file = path.join(docsDir, `${page}.mdx`)
    if (!(await fileExists(file))) {
      failures.push(`docs.json references missing page ${page}`)
    }
  }

  return pages
}

function collectNavPages(value: unknown, pages: Set<string>) {
  if (typeof value === 'string') {
    pages.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNavPages(item, pages)
    return
  }
  if (!value || typeof value !== 'object') return

  const record = value as Record<string, unknown>
  collectNavPages(record.pages, pages)
  const openapi = record.openapi
  if (openapi && typeof openapi === 'object') {
    const directory = (openapi as Record<string, unknown>).directory
    if (typeof directory === 'string') pages.add(`${directory}/*`)
  }
}

async function checkMdxOrphans(navPages: Set<string>, failures: string[]) {
  const files = (await listFiles(docsDir))
    .filter((file) => file.endsWith('.mdx'))
    .map((file) => relativeToDocs(file).replace(/\.mdx$/, ''))

  const importedSnippets = await collectImportedSnippets()
  const navPrefixes = [...navPages].filter((page) => page.endsWith('/*')).map((page) => page.slice(0, -1))

  for (const file of files) {
    const inNav = navPages.has(file)
    const generatedByOpenApi = navPrefixes.some((prefix) => file.startsWith(prefix))
    const importedSnippet = importedSnippets.has(`${file}.mdx`) || importedSnippets.has(file)
    if (!inNav && !generatedByOpenApi && !importedSnippet) {
      failures.push(`orphan MDX page docs/${file}.mdx is not in docs.json and is not an imported snippet`)
    }
  }
}

async function collectImportedSnippets() {
  const imported = new Set<string>()
  const files = (await listFiles(docsDir)).filter((file) => file.endsWith('.mdx'))
  for (const file of files) {
    const text = await readFile(file, 'utf8')
    for (const match of text.matchAll(/from\s+["']\/(snippets\/[^"']+?)["']/g)) {
      const snippet = match[1]
      if (snippet) imported.add(snippet)
    }
  }
  return imported
}

async function checkLocalLinks(failures: string[]) {
  const files = (await listFiles(docsDir)).filter((file) => file.endsWith('.mdx') || file.endsWith('.md'))
  for (const file of files) {
    const text = await readFile(file, 'utf8')
    const links = extractMarkdownLinks(text)
    const imports = extractMdxImports(text)
    for (const href of [...links, ...imports]) {
      await checkLocalHref(file, href, failures)
    }
  }
}

async function checkLocalHref(sourceFile: string, href: string, failures: string[]) {
  if (isExternalLink(href) || href.startsWith('mailto:')) return

  const [targetPart = '', anchorPart] = href.split('#')
  let targetFile = targetPart
    ? resolveDocsTarget(sourceFile, decodeURIComponent(targetPart))
    : sourceFile

  if (!isInsideDirectory(targetFile, docsDir)) {
    failures.push(`${relative(sourceFile)} links outside the public docs root: ${href}`)
    return
  }

  if (!(await fileExists(targetFile))) {
    const extension = path.extname(targetFile)
    if (!extension && (await fileExists(`${targetFile}.mdx`))) {
      targetFile = `${targetFile}.mdx`
    } else if (!extension && (await fileExists(`${targetFile}.md`))) {
      targetFile = `${targetFile}.md`
    } else {
      failures.push(`${relative(sourceFile)} links to missing target ${href}`)
      return
    }
  }

  const targetStat = await stat(targetFile)
  if (!targetStat.isFile()) {
    failures.push(`${relative(sourceFile)} links to non-file target ${href}`)
    return
  }

  if (!anchorPart) return

  const targetText = await readFile(targetFile, 'utf8')
  const anchors = markdownHeadingAnchors(targetText)
  const expected = decodeURIComponent(anchorPart)
  if (!anchors.has(expected)) {
    failures.push(`${relative(sourceFile)} links to missing anchor #${expected} in ${relative(targetFile)}`)
  }
}

function resolveDocsTarget(sourceFile: string, targetPart: string) {
  if (targetPart.startsWith('/')) return path.join(docsDir, targetPart.slice(1))
  return path.resolve(path.dirname(sourceFile), targetPart)
}

async function checkStalePublicTerms(failures: string[]) {
  const files = (await listFiles(docsDir)).filter(
    (file) => file.endsWith('.mdx') || file.endsWith('.md') || file.endsWith('.json'),
  )
  for (const file of files) {
    if (file === openApiFile) continue
    const text = await readFile(file, 'utf8')
    for (const { label, pattern } of stalePublicPatterns) {
      if (pattern.test(text)) failures.push(`${relative(file)} contains ${label}`)
    }
  }
}

async function checkConfigExamples(failures: string[]) {
  const entries = await readdir(configExamplesDir, { withFileTypes: true })
  const exampleFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(configExamplesDir, entry.name))
    .sort()

  if (exampleFiles.length === 0) failures.push('docs/config contains no JSON examples')

  for (const file of exampleFiles) {
    try {
      const config = await loadOverlayConfig({
        configFilePath: file,
        defaultConfig: {} as OverlayRuntimeConfigInput,
        env: {},
      })
      const summary = getRedactedOverlayRuntimeConfigSummary(config)
      const serialized = JSON.stringify(summary)
      if (/(secret|token|apiKey|api_key)/i.test(serialized) && /placeholder|replace_with/i.test(serialized)) {
        failures.push(`${relative(file)} redacted summary appears to include a placeholder secret`)
      }
    } catch (error) {
      const formatted = formatOverlayConfigError(error)
      failures.push(`${relative(file)} does not parse: ${formatted.message}${formatIssues(formatted.issues)}`)
    }

    const text = await readFile(file, 'utf8')
    for (const { label, pattern } of disallowedExamplePatterns) {
      const match = pattern.exec(text)
      if (match) failures.push(`${relative(file)} contains ${label} pattern "${match[0]}"`)
    }
  }
}

async function checkOpenApiOutput(failures: string[]) {
  if (!(await fileExists(openApiFile))) {
    failures.push('docs/openapi/overlay-web.openapi.json is missing')
    return
  }

  const spec = JSON.parse(await readFile(openApiFile, 'utf8')) as OpenApiSpec
  const publicDefinitions = webApiBoundaryDefinitions.filter((definition) => definition.publicReference !== false)
  const operationCount = Object.values(spec.paths ?? {}).reduce(
    (count, pathItem) =>
      count +
      Object.keys(pathItem).filter((method) => ['get', 'post', 'put', 'patch', 'delete'].includes(method)).length,
    0,
  )

  if (operationCount !== publicDefinitions.length) {
    failures.push(
      `OpenAPI operation count ${operationCount} does not match public API boundary count ${publicDefinitions.length}`,
    )
  }

  for (const definition of publicDefinitions) {
    const pathItem = spec.paths?.[definition.path]
    const operation = pathItem?.[definition.method.toLowerCase()]
    if (!operation) {
      failures.push(`OpenAPI is missing ${definition.method} ${definition.path}`)
      continue
    }
    const expectedOperationId = operationIdFor(definition.method, definition.path)
    if (operation.operationId !== expectedOperationId) {
      failures.push(`OpenAPI operationId mismatch for ${definition.method} ${definition.path}`)
    }
    if (operation.summary !== definition.summary) {
      failures.push(`OpenAPI summary mismatch for ${definition.method} ${definition.path}`)
    }
  }
}

async function checkProviderDocs(failures: string[]) {
  const providerDocs = [
    await readFile(path.join(docsDir, 'configure/providers.mdx'), 'utf8'),
    await readFile(path.join(docsDir, 'configure/runtime-config.mdx'), 'utf8'),
    await readFile(path.join(docsDir, 'deploy-operate/self-hosting.mdx'), 'utf8'),
  ].join('\n')

  const providerSets = [
    ['auth', OverlayAuthProviderSchema.options],
    ['billing', OverlayBillingProviderSchema.options],
    ['object storage', OverlayStorageProviderSchema.options],
    ['database', OverlayDatabaseProviderSchema.options],
    ['vector search', OverlayVectorSearchProviderSchema.options],
    ['embeddings', OverlayEmbeddingsProviderSchema.options],
    ['models', OverlayLlmGatewayProviderSchema.options],
    ['integrations', OverlayIntegrationsProviderSchema.options],
    ['browser', OverlayBrowserProviderSchema.options],
    ['sandbox', OverlaySandboxProviderSchema.options],
    ['web search', OverlayWebSearchProviderSchema.options],
    ['analytics', OverlayAnalyticsProviderSchema.options],
    ['error reporting', OverlayErrorReportingProviderSchema.options],
    ['secrets', OverlaySecretsProviderSchema.options],
    ['rate limit', OverlayRateLimitProviderSchema.options],
  ] as const

  for (const [label, options] of providerSets) {
    for (const option of options) {
      if (!providerDocs.includes(`\`${option}\``)) {
        failures.push(`provider docs are missing ${label} provider \`${option}\``)
      }
    }
  }

  for (const required of ['configVersion', 'compliance', 'features', 'providers', 'capability_disabled']) {
    if (!providerDocs.includes(required)) failures.push(`runtime/provider docs are missing ${required}`)
  }
}

function operationIdFor(method: string, openApiPath: string) {
  const suffix = openApiPath
    .replace(/^\/api\/v1\/?/, '')
    .replace(/\{([^}]+)\}/g, '$1')
    .split(/[/-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
  return `${method.toLowerCase()}${suffix || 'Root'}`
}

function extractMarkdownLinks(text: string): string[] {
  const withoutCodeBlocks = text.replace(/```[\s\S]*?```/g, '')
  const links: string[] = []
  const markdownLinkPattern = /(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  for (const match of withoutCodeBlocks.matchAll(markdownLinkPattern)) {
    const href = match[1]
    if (href) links.push(href)
  }
  return links
}

function extractMdxImports(text: string): string[] {
  const imports: string[] = []
  for (const match of text.matchAll(/from\s+["']([^"']+\.mdx)["']/g)) {
    const href = match[1]
    if (href) imports.push(href)
  }
  return imports
}

function markdownHeadingAnchors(text: string): Set<string> {
  const anchors = new Set<string>()
  const counts = new Map<string, number>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (!match) continue
    const base = githubAnchor(match[2] ?? '')
    const count = counts.get(base) ?? 0
    counts.set(base, count + 1)
    anchors.add(count === 0 ? base : `${base}-${count}`)
  }
  return anchors
}

function githubAnchor(heading: string): string {
  return heading
    .trim()
    .replace(/`([^`]+)`/g, '$1')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(entryPath)))
    } else if (entry.isFile()) {
      files.push(entryPath)
    }
  }
  return files.sort()
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

function isExternalLink(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href)
}

function relative(file: string): string {
  return path.relative(root, file).split(path.sep).join('/')
}

function relativeToDocs(file: string): string {
  return path.relative(docsDir, file).split(path.sep).join('/')
}

function isInsideDirectory(file: string, directory: string) {
  const relativePath = path.relative(directory, file)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

function formatIssues(issues: readonly string[]) {
  return issues.length > 0 ? ` (${issues.join('; ')})` : ''
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
