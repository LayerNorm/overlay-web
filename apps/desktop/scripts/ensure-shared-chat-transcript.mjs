import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rendererRoot = path.join(repoRoot, 'src/renderer/src')
const workspaceRoot = path.resolve(repoRoot, '..')

const retiredPaths = [
  'src/renderer/src/components/MarkdownRenderer.tsx',
  'src/renderer/src/components/ui/ToolCallInline.tsx',
  'src/renderer/src/components/chat/LoadingIndicator.tsx',
  'src/renderer/src/components/chat/ChatStyles.tsx',
  'src/renderer/src/components/chat/SharedMessageList.tsx',
  'src/renderer/src/components/chat/chatTranscriptFeatureFlag.ts',
  'src/renderer/src/components/chat/chatTranscriptFeatureFlag.test.ts'
]

const violations = retiredPaths
  .filter((file) => fs.existsSync(path.join(repoRoot, file)))
  .map((file) => `${file} must stay deleted`)

// JavaScript guard script; the recursive result is always an array of absolute paths.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function sourceFiles(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(file)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [file] : []
  })
}

const retiredTokens = [
  'SharedMessageList',
  'ChatStyles',
  'MarkdownRenderer',
  'ToolCallInline',
  'chatTranscriptFeatureFlag',
  'USE_SHARED_DESKTOP_CHAT_TRANSCRIPT',
  'OVERLAY_DESKTOP_CHAT_TRANSCRIPT_V2',
  'assistantSegments',
  'renderToolParts'
]

for (const file of sourceFiles(rendererRoot)) {
  const source = fs.readFileSync(file, 'utf8')
  for (const token of retiredTokens) {
    if (source.includes(token)) {
      violations.push(`${path.relative(repoRoot, file)} references retired ${token}`)
    }
  }
}

const conversationalRoots = [
  'src/renderer/src/components/chat',
  'src/renderer/src/components/browser',
  'src/renderer/src/components/notebook'
]
const forbiddenRendererName =
  /(?:MarkdownRenderer|MessageActions|ExchangeActions|ExchangeLoading|LoadingIndicator|ToolCalls?(?:Group|List|Renderer)|MediaExchange|MediaRenderer|MessageRenderer|TranscriptRenderer)\.tsx$/i
const allowedNonTranscriptRendererPaths = new Set([
  path.join(repoRoot, 'src/renderer/src/components/browser/common/LoadingIndicator.tsx')
])
for (const root of conversationalRoots) {
  for (const file of sourceFiles(path.join(repoRoot, root))) {
    const source = fs.readFileSync(file, 'utf8')
    if (/from\s+['"]react-markdown['"]/.test(source)) {
      violations.push(`${path.relative(repoRoot, file)} adds an independent Markdown renderer`)
    }
    if (
      forbiddenRendererName.test(path.basename(file)) &&
      !allowedNonTranscriptRendererPaths.has(file)
    ) {
      violations.push(`${path.relative(repoRoot, file)} adds an independent transcript renderer`)
    }
  }
}

const embeddedConsumers = [
  'src/renderer/src/components/browser/BrowserAgentChat.tsx'
]
for (const file of embeddedConsumers) {
  const source = fs.readFileSync(path.join(repoRoot, file), 'utf8')
  if (!source.includes('EmbeddedChatTranscript')) {
    violations.push(`${file} must render through EmbeddedChatTranscript`)
  }
}

const sharedNotebook = fs.readFileSync(
  path.join(repoRoot, 'src/renderer/src/features/notebook/DesktopNotebookEditor.tsx'),
  'utf8'
)
if (!sharedNotebook.includes('CanonicalNotebookEditor')) {
  violations.push('DesktopNotebookEditor must use the canonical shared notebook transcript')
}

const canonicalConsumers = [
  'src/renderer/src/pages/ChatPanel.tsx',
  'src/renderer/src/components/chat/ChatConversationView.tsx'
]
for (const file of canonicalConsumers) {
  const source = fs.readFileSync(path.join(repoRoot, file), 'utf8')
  if (!source.includes('DesktopChatTranscript')) {
    violations.push(`${file} must render through DesktopChatTranscript`)
  }
}

const canonicalRenderer = fs.readFileSync(
  path.join(repoRoot, 'src/renderer/src/components/chat/DesktopChatTranscript.tsx'),
  'utf8'
)
for (const token of ['ChatTranscript', 'MediaExchange', 'onBranch', 'onOpenSources']) {
  if (!canonicalRenderer.includes(token)) {
    violations.push(`DesktopChatTranscript must delegate ${token} to @overlay/chat-react`)
  }
}

const desktopSourcesPanel = fs.readFileSync(
  path.join(repoRoot, 'src/renderer/src/components/chat/DesktopSourcesPanel.tsx'),
  'utf8'
)
for (const token of [
  "from '@overlay/chat-react/sources-panel'",
  'window.bridge.openExternal'
]) {
  if (!desktopSourcesPanel.includes(token)) {
    violations.push(`DesktopSourcesPanel must preserve the shared source boundary via ${token}`)
  }
}

const chatPanel = fs.readFileSync(
  path.join(repoRoot, 'src/renderer/src/pages/ChatPanel.tsx'),
  'utf8'
)
for (const token of ['DesktopSourcesPanel', 'cloneMessagesThroughTurn']) {
  if (!chatPanel.includes(token)) {
    violations.push(`ChatPanel must preserve desktop chat parity via ${token}`)
  }
}

const desktopStyles = fs.readFileSync(
  path.join(repoRoot, 'src/renderer/src/styles/shared-chat.css'),
  'utf8'
)
if (!/@import\s+['"]@overlay\/chat-react\/chat-surface\.css['"]\s*;/.test(desktopStyles)) {
  violations.push('desktop shared-chat.css must import the canonical chat stylesheet')
}

const embeddedContractTest = fs.readFileSync(
  path.join(repoRoot, 'src/renderer/src/components/chat/embeddedChatTranscriptAdapter.test.ts'),
  'utf8'
)
for (const token of ['createDesktopChatTranscriptAdapter', "'reasoning'", "'tool'", "'text'"]) {
  if (!embeddedContractTest.includes(token)) {
    violations.push(`embedded fixture adapter contract test must contain ${token}`)
  }
}

for (const file of [
  'packages/overlay-chat-react/src/components/ExchangeBlock.tsx',
  'packages/overlay-chat-react/src/components/MessageList.tsx',
  'packages/overlay-chat-react/src/components/tools'
]) {
  if (fs.existsSync(path.join(workspaceRoot, file))) {
    violations.push(`${file} must stay deleted from the shared renderer package`)
  }
}

const buildConfig = fs.readFileSync(path.join(repoRoot, 'electron.vite.config.ts'), 'utf8')
const packageJson = fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
if (buildConfig.includes('OVERLAY_DESKTOP_CHAT_TRANSCRIPT_V2')) {
  violations.push('electron.vite.config.ts still exposes the retired transcript rollback flag')
}
if (packageJson.includes('dev:legacy-chat')) {
  violations.push('package.json still exposes the retired legacy-chat command')
}

if (violations.length) {
  console.error(
    `Shared chat transcript guard failed:\n${violations.map((item) => `- ${item}`).join('\n')}`
  )
  process.exit(1)
}

console.log('Shared chat transcript guard passed.')
