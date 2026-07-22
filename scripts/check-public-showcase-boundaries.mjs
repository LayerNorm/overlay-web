import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')
const violations = []

const required = [
  'src/app/about/page.tsx',
  'src/app/explore/[surface]/page.tsx',
  'src/app/app/_components/AppShellSidebar.tsx',
  'src/components/layout/AppSidebar.tsx',
  'src/features/chat/components/ChatExperience.tsx',
  'src/features/showcase/PublicShowcaseKnowledgeView.tsx',
  'src/features/showcase/PublicShowcaseProjectsView.tsx',
  'src/features/showcase/PublicShowcaseAutomationsView.tsx',
  'src/features/showcase/PublicShowcaseToolsView.tsx',
  'src/features/showcase/showcase-data.ts',
]
for (const path of required) {
  if (!existsSync(join(root, path))) violations.push(`${path} must exist`)
}

if (existsSync(join(root, 'src/features/marketing/components/ProductAppDemo.tsx'))) {
  violations.push('the retired parallel ProductAppDemo must stay deleted')
}
for (const retiredPath of [
  'src/features/showcase/ShowcaseWorkspace.tsx',
  'src/features/showcase/useShowcaseSession.ts',
  'src/app/api/public/showcase/ask/route.ts',
]) {
  if (existsSync(join(root, retiredPath))) {
    violations.push(`${retiredPath} must stay deleted; the showcase uses the real app shell and static adapters`)
  }
}

const rootPage = read('src/app/page.tsx')
if (!rootPage.includes('getOverlaySession')) violations.push('root must remain adaptive to authenticated sessions')
if (!rootPage.includes("redirect('/app/chat')")) violations.push('authenticated root must redirect to the real app')
if (!rootPage.includes("redirect('/app/chat?showcase=1&id=showcase-welcome')")) {
  violations.push('signed-out root must enter the real app shell in public showcase mode')
}

const appSidebar = read('src/components/layout/AppSidebar.tsx')
if (!appSidebar.includes('publicShowcase')) violations.push('the real app sidebar must own public showcase mode')
if (!appSidebar.includes('setShowcaseSidebarCollapsed')) violations.push('the real app sidebar must remain expandable in public mode')

const shellSidebar = read('src/app/app/_components/AppShellSidebar.tsx')
for (const adapter of [
  'SHOWCASE_CHAT_SUMMARIES',
  'PublicShowcaseFilesInlinePanel',
  'PublicShowcaseProjectsInlinePanel',
  'PublicShowcaseAutomationsInlinePanel',
]) {
  if (!shellSidebar.includes(adapter)) violations.push(`the real app sidebar must use ${adapter}`)
}

const chatPage = read('src/app/app/chat/page.tsx')
if (!chatPage.includes('publicShowcaseSnapshots')) violations.push('the real chat renderer must receive static showcase snapshots')

const chatExperience = read('src/features/chat/components/ChatExperience.tsx')
if (!chatExperience.includes('isPublicShowcase')) violations.push('the real chat renderer must support read-only public data')
if (!chatExperience.includes('if (!activeChatId || isPublicShowcase) return')) {
  violations.push('public showcase hydration must not persist chat mutations')
}

const knowledge = read('src/features/showcase/PublicShowcaseKnowledgeView.tsx')
if (!knowledge.includes('SharedKnowledgeSurface')) violations.push('public files must use the shared production knowledge surface')
if (!knowledge.includes('FileViewer')) violations.push('public files must use the shared production file viewer')

const projects = read('src/features/showcase/PublicShowcaseProjectsView.tsx')
if (!projects.includes('ProjectsModuleShell')) violations.push('public projects must use the production project shell')

const automations = read('src/features/showcase/PublicShowcaseAutomationsView.tsx')
if (!automations.includes('AutomationGraphCanvas')) violations.push('public automations must use the production automation graph')

const tools = read('src/features/showcase/PublicShowcaseToolsView.tsx')
if (!tools.includes('IntegrationsPanel')) violations.push('public extensions must use the production integrations panel')

const home = read('src/app/home/page.tsx')
if (!home.includes("redirect('/')")) violations.push('/home must redirect to the public workspace')

if (violations.length > 0) {
  console.error('Public showcase boundary check failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('Public showcase boundaries passed.')
