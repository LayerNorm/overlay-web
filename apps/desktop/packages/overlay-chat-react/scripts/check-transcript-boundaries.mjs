import { builtinModules } from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const workspaceRoot = dirname(dirname(packageRoot))
const chatReactSourceRoot = join(packageRoot, 'src')
const chatCoreSourceRoot = join(workspaceRoot, 'packages/overlay-chat-core/src')
const desktopRoot = join(workspaceRoot, 'overlay-desktop')

const retiredPaths = [
  'src/components/ExchangeBlock.tsx',
  'src/components/MessageList.tsx',
  'src/components/tools'
]

const violations = retiredPaths
  .filter((path) => existsSync(join(packageRoot, path)))
  .map((path) => `${path} must stay deleted`)

function sourceFiles(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:js|jsx|ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

function productionSourceFiles(directory) {
  return sourceFiles(directory).filter(
    (path) => !/\.(?:test|spec)\.[jt]sx?$/.test(path) && !path.endsWith('.d.ts')
  )
}

function importSpecifiers(source) {
  const specifiers = []
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /^\s*import\s+['"]([^'"]+)['"]/gm,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1])
  }
  return specifiers
}

const builtinRoots = new Set(
  builtinModules.map((specifier) => specifier.replace(/^node:/, '').split('/')[0])
)

function platformImportReason(specifier) {
  if (specifier === 'server-only' || specifier === '@/server' || specifier.startsWith('@/server/')) {
    return 'server-only application code'
  }
  if (specifier === 'next' || specifier.startsWith('next/')) return 'Next.js'
  if (
    specifier === 'electron' ||
    specifier.startsWith('electron/') ||
    specifier.startsWith('@electron/') ||
    specifier.startsWith('@electron-toolkit/')
  ) {
    return 'Electron'
  }
  const normalized = specifier.replace(/^node:/, '')
  if (specifier.startsWith('node:') || builtinRoots.has(normalized.split('/')[0])) {
    return 'a Node builtin'
  }
  return null
}

for (const root of [chatCoreSourceRoot, chatReactSourceRoot]) {
  for (const path of productionSourceFiles(root)) {
    const source = readFileSync(path, 'utf8')
    for (const specifier of importSpecifiers(source)) {
      const reason = platformImportReason(specifier)
      if (reason) {
        violations.push(
          `${relative(workspaceRoot, path)} imports ${reason} module ${JSON.stringify(specifier)}`
        )
      }
    }
  }
}

for (const path of sourceFiles(chatReactSourceRoot)) {
  const source = readFileSync(path, 'utf8')
  if (/from\s+['"][^'"]*\/components\/tools(?:\/|['"])/.test(source)) {
    violations.push(`${relative(packageRoot, path)} imports the retired tool renderer family`)
  }
  if (/\b(?:ExchangeBlock|MessageList|ToolCallGroup)\b/.test(source)) {
    violations.push(`${relative(packageRoot, path)} references a retired transcript compatibility API`)
  }
}

const packageJson = readFileSync(join(packageRoot, 'package.json'), 'utf8')
if (packageJson.includes('exchange-block')) {
  violations.push('package.json exports the retired exchange-block compatibility path')
}

const canonicalStylesheet = '@overlay/chat-react/chat-surface.css'
const requiredImports = [
  {
    path: join(workspaceRoot, 'src/app/layout.tsx'),
    matches: (source) => importSpecifiers(source).includes(canonicalStylesheet),
    message: 'the web app must import the canonical chat stylesheet'
  },
  {
    path: join(desktopRoot, 'src/renderer/src/styles/shared-chat.css'),
    matches: (source) =>
      new RegExp(`@import\\s+["']${canonicalStylesheet.replaceAll('/', '\\/')}["']`).test(source),
    message: 'desktop shared-chat.css must import the canonical chat stylesheet'
  },
  {
    path: join(workspaceRoot, 'src/features/chat/components/ChatMessageList.tsx'),
    matches: (source) => source.includes('ChatTranscript'),
    message: 'web ChatMessageList must render through ChatTranscript'
  },
  {
    path: join(workspaceRoot, 'src/features/chat/components/ChatToolSurface.tsx'),
    matches: (source) => importSpecifiers(source).includes('@overlay/chat-react/transcript'),
    message: 'web text exchanges must delegate to the shared transcript package'
  },
  {
    path: join(workspaceRoot, 'src/features/chat/components/ChatMediaMessage.tsx'),
    matches: (source) => source.includes('MediaExchange'),
    message: 'web media exchanges must delegate to shared MediaExchange'
  }
]

for (const requirement of requiredImports) {
  if (!existsSync(requirement.path) || !requirement.matches(readFileSync(requirement.path, 'utf8'))) {
    violations.push(requirement.message)
  }
}

const webChatRoot = join(workspaceRoot, 'src/features/chat')
const allowedDirectMarkdownFiles = new Set([
  join(workspaceRoot, 'src/features/chat/components/MarkdownMessage.tsx')
])
const allowedSemanticRendererFiles = new Set([
  ...allowedDirectMarkdownFiles,
  join(workspaceRoot, 'src/features/chat/components/ChatToolSurface.tsx'),
  join(workspaceRoot, 'src/features/chat/components/ChatMediaMessage.tsx')
])
const forbiddenRendererName =
  /(?:Markdown(?:Message|Renderer)|MessageActions|ExchangeActions|ExchangeLoading|LoadingIndicator|(?:Chat)?ToolCalls?(?:Group|List|Renderer|Surface)|(?:Chat|Message)?Media(?:Message|Exchange|Renderer)|MessageRenderer|TranscriptRenderer)\.[jt]sx?$/i

for (const path of productionSourceFiles(webChatRoot)) {
  const source = readFileSync(path, 'utf8')
  if (importSpecifiers(source).includes('react-markdown') && !allowedDirectMarkdownFiles.has(path)) {
    violations.push(`${relative(workspaceRoot, path)} adds an independent Markdown renderer`)
  }
  if (forbiddenRendererName.test(basename(path)) && !allowedSemanticRendererFiles.has(path)) {
    violations.push(`${relative(workspaceRoot, path)} adds an independent transcript renderer`)
  }
}

const fixtureContractTest = join(
  workspaceRoot,
  'src/features/chat/components/chat/toChatTranscriptView.test.ts'
)
const fixtureContractSource = existsSync(fixtureContractTest)
  ? readFileSync(fixtureContractTest, 'utf8')
  : ''
for (const token of [
  'CHAT_PARITY_TEXT_SCENARIOS',
  'createWebChatTranscriptAdapter',
  'createDesktopChatTranscriptAdapter',
  'assert.deepEqual(desktopView, webView)'
]) {
  if (!fixtureContractSource.includes(token)) {
    violations.push(`the cross-platform fixture adapter contract test must contain ${token}`)
  }
}

if (violations.length) {
  console.error(
    `Chat transcript boundary check failed:\n${violations.map((item) => `- ${item}`).join('\n')}`
  )
  process.exit(1)
}

console.log('Chat transcript boundary check passed.')
