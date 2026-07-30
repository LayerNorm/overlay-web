import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')
const violations = []

const required = [
  'src/app/about/page.tsx',
  'src/app/explore/[surface]/page.tsx',
  'src/app/app/_components/AppShellSidebar.tsx',
  'src/app/app/home/page.tsx',
  'src/app/app/manifesto/page.tsx',
  'src/app/app/pricing/page.tsx',
  'src/app/robots.ts',
  'src/app/sitemap.ts',
  'src/components/layout/AppSidebar.tsx',
  'src/components/layout/sidebar/SidebarAccountMenu.tsx',
  'src/features/chat/components/ChatExperience.tsx',
  'src/features/showcase/RootEntryResolver.tsx',
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
if (!rootPage.includes('redirect(ROOT_APP_DESTINATION)')) violations.push('authenticated root must redirect to the real app')
if (!rootPage.includes('<RootEntryResolver />')) {
  violations.push('unresolved root sessions must use the refresh-capable entry resolver')
}

const rootEntry = read('src/shared/auth/root-entry.ts')
if (!rootEntry.includes("ROOT_SHOWCASE_DESTINATION = '/app/chat?showcase=1&id=showcase-welcome'")) {
  violations.push('confirmed signed-out root sessions must enter the real app shell in public showcase mode')
}
if (!rootEntry.includes("if (resolution === 'transient-error')") && !rootEntry.includes('return null')) {
  violations.push('transient root auth failures must never be classified as showcase guests')
}

const appSidebar = read('src/components/layout/AppSidebar.tsx')
if (!appSidebar.includes('publicShowcase')) violations.push('the real app sidebar must own public showcase mode')
if (!appSidebar.includes('setShowcaseSidebarCollapsed')) violations.push('the real app sidebar must remain expandable in public mode')
if (!appSidebar.includes('useState(false)')) violations.push('the public showcase sidebar must start expanded')
for (const route of ['/app/home?showcase=1', '/app/manifesto?showcase=1', '/app/pricing?showcase=1']) {
  if (!appSidebar.includes(route)) violations.push(`public marketing navigation must remain in the app shell: ${route}`)
}
if (!appSidebar.includes('ROOT_APP_DESTINATION')) {
  violations.push('authenticated showcase users must have an App return link')
}
if (!appSidebar.includes('MARKETING_DOCS_URL')) {
  violations.push('the app sidebar must use the canonical documentation URL')
}

const accountMenu = read('src/components/layout/sidebar/SidebarAccountMenu.tsx')
if (!accountMenu.includes('demoHref') || !accountMenu.includes('Demo')) {
  violations.push('the authenticated account menu must expose the public Demo workspace')
}

const sessionRoute = read('src/app/api/auth/session/route.ts')
if (!sessionRoute.includes("code: 'session_resolution_failed'") || !sessionRoute.includes('status: 503')) {
  violations.push('transient session resolution failures must not be reported as confirmed sign-out')
}

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
if (!projects.includes('ProjectDetail')) violations.push('public projects must use the production project detail')
if (projects.includes('ProjectsModuleShell')) violations.push('public projects must not render a second project sidebar')

const automations = read('src/features/showcase/PublicShowcaseAutomationsView.tsx')
if (!automations.includes('AutomationGraphCanvas')) violations.push('public automations must use the production automation graph')

const tools = read('src/features/showcase/PublicShowcaseToolsView.tsx')
if (!tools.includes('IntegrationsPanel')) violations.push('public extensions must use the production integrations panel')

const showcaseData = read('src/features/showcase/showcase-data.ts')
if (!showcaseData.includes('logos:google-gmail.svg') || !showcaseData.includes('logos:github-icon.svg')) {
  violations.push('static showcase connectors must include real logo assets')
}

const signInForm = read('src/features/auth/components/SignInForm.tsx')
if (!signInForm.includes('Loading sign-in options')) violations.push('sign-in prompts must render a loading state while auth options hydrate')

const marketingShell = read('src/features/marketing/components/StaticMarketingShell.tsx')
if (!marketingShell.includes('pathname.startsWith("/app/")')) {
  violations.push('marketing bodies must embed inside the production app shell')
}
for (const route of ['/home', '/manifesto', '/pricing']) {
  if (!marketingShell.includes(`pathname === "${route}"`)) {
    violations.push(`clean marketing route must not render a second shell: ${route}`)
  }
}

const publicSiteRail = read('src/components/layout/PublicSiteRail.tsx')
if (publicSiteRail.includes('label="About"')) {
  violations.push('the retired About destination must stay out of public navigation')
}

const home = read('src/app/home/page.tsx')
if (!home.includes("redirect('/app/home?showcase=1')")) violations.push('/home must redirect to the in-shell public marketing page')
for (const [path, destination] of [
  ['src/app/about/page.tsx', '/app/home?showcase=1'],
  ['src/app/manifesto/page.tsx', '/app/manifesto?showcase=1'],
  ['src/app/pricing/page.tsx', '/app/pricing?showcase=1'],
]) {
  if (!read(path).includes(`redirect('${destination}')`)) {
    violations.push(`${path} must redirect to ${destination}`)
  }
}

const middleware = read('src/middleware.ts')
for (const route of ["'/home': '/app/home'", "'/manifesto': '/app/manifesto'", "'/pricing': '/app/pricing'"]) {
  if (!middleware.includes(route)) violations.push(`clean marketing routes must rewrite into the app shell: ${route}`)
}

const marketing = read('src/shared/marketing/marketing.ts')
if (!marketing.includes('"https://getoverlay.io/docs"')) {
  violations.push('all Docs navigation must target https://getoverlay.io/docs')
}

for (const [path, canonical] of [
  ['src/app/app/home/page.tsx', "canonical: '/home'"],
  ['src/app/app/manifesto/page.tsx', "canonical: '/manifesto'"],
  ['src/app/app/pricing/page.tsx', "canonical: '/pricing'"],
]) {
  const source = read(path)
  if (!source.includes(canonical) || !source.includes('index: true')) {
    violations.push(`${path} must expose indexable metadata for ${canonical}`)
  }
}

const appLayout = read('src/app/app/layout.tsx')
if (!appLayout.includes('index: false')) {
  violations.push('non-marketing app and showcase routes must remain out of the search index')
}

if (violations.length > 0) {
  console.error('Public showcase boundary check failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('Public showcase boundaries passed.')
