import {
  normalizeKnowledgeSurfaceNode,
  type ConnectorCatalogItem,
  type KnowledgeSurfaceNode,
} from '@overlay/app-core'
import {
  FILE_PARITY_AUDIO_DATA_URL,
  FILE_PARITY_IMAGE_DATA_URL,
  FILE_PARITY_VIDEO_DATA_URL,
} from '@overlay/app-core/file-parity-fixtures'
import type { WorkspaceSummary } from '@overlay/workspace-contracts'

export type ShowcaseSurface = 'chat' | 'files' | 'projects' | 'automations' | 'extensions'

export const SHOWCASE_WORKSPACES: WorkspaceSummary[] = [
  {
    id: 'showcase-personal',
    name: 'Divyansh',
    slug: 'divyansh',
    kind: 'personal',
    status: 'active',
    role: 'owner',
    memberCount: 1,
  },
  {
    id: 'showcase-acme',
    name: 'Acme',
    slug: 'acme',
    kind: 'organization',
    status: 'active',
    role: 'owner',
    memberCount: 8,
  },
  {
    id: 'showcase-design',
    name: 'Design partners',
    slug: 'design-partners',
    kind: 'organization',
    status: 'active',
    role: 'member',
    memberCount: 14,
  },
]

export interface ShowcaseMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
}

export interface ShowcaseConversation {
  id: string
  title: string
  eyebrow: string
  messages: ShowcaseMessage[]
}

export interface ShowcaseFile {
  id: string
  name: string
  kind: 'note' | 'file'
  content: string
  url?: string
}

export const SHOWCASE_CONVERSATIONS: ShowcaseConversation[] = [
  {
    id: 'welcome',
    title: 'Start here',
    eyebrow: 'A workspace that can act',
    messages: [
      { id: 'welcome-user', role: 'user', text: 'What can I do with Overlay?' },
      {
        id: 'welcome-assistant',
        role: 'assistant',
        text: `Overlay gives you one place to **think, find, create, and act** with AI.\n\n- Search the web and cite the answer\n- Remember useful context across conversations\n- Work with files, notes, projects, and connected apps\n- Run browser and code tasks in isolated sandboxes\n- Generate images and video\n- Turn recurring work into automations\n\nEverything in this workspace uses Overlay's real product surfaces. Open the chats and files on the left; actions that would change data ask you to sign in.`,
      },
    ],
  },
  {
    id: 'research',
    title: 'Research with sources',
    eyebrow: 'Search the web',
    messages: [
      { id: 'research-user', role: 'user', text: 'Compare the best approaches to deploying private AI for a 200-person company.' },
      {
        id: 'research-assistant',
        role: 'assistant',
        text: `I searched current provider documentation and compared three paths: hosted private cloud, customer VPC, and fully on-premises.\n\n**Best default:** start in a customer-owned VPC, keep model routing portable, and reserve on-premises for regulated workloads that truly require it. Overlay keeps the workspace and policy layer consistent across all three.`,
      },
    ],
  },
  {
    id: 'memory',
    title: 'Remember the important parts',
    eyebrow: 'Memory and recall',
    messages: [
      { id: 'memory-user', role: 'user', text: 'Remember that our launch principle is clarity over cleverness.' },
      { id: 'memory-assistant', role: 'assistant', text: 'Saved. I’ll use **clarity over cleverness** when helping with launch writing and product decisions.' },
    ],
  },
  {
    id: 'files',
    title: 'Analyze a launch folder',
    eyebrow: 'Files and projects',
    messages: [
      { id: 'files-user', role: 'user', text: 'Read the launch brief, metrics CSV, and customer notes. What deserves attention first?' },
      { id: 'files-assistant', role: 'assistant', text: `The biggest opportunity is activation. The brief promises fast time-to-value, but the metrics show a drop between connecting a source and completing the first useful task.\n\nI’d make the first-run path demonstrate one complete outcome before presenting the rest of the workspace.` },
    ],
  },
  {
    id: 'connectors',
    title: 'Work across connected apps',
    eyebrow: 'Connectors and skills',
    messages: [
      { id: 'connectors-user', role: 'user', text: 'Summarize today’s customer email, add the follow-ups to Linear, and draft a reply.' },
      { id: 'connectors-assistant', role: 'assistant', text: 'I found the customer thread, extracted three follow-ups, and prepared the Linear issues and reply as a reviewable draft. External actions always remain visible and permissioned.' },
    ],
  },
  {
    id: 'create',
    title: 'Create in every medium',
    eyebrow: 'Images, video, and code',
    messages: [
      { id: 'create-user', role: 'user', text: 'Turn this product idea into a launch visual, a 15-second storyboard, and a working prototype.' },
      { id: 'create-assistant', role: 'assistant', text: 'I created a visual direction, a scene-by-scene storyboard, and a sandboxed prototype. You can inspect every output, branch from any response, or save the useful pieces to a project.' },
    ],
  },
]

export const SHOWCASE_CHAT_SUMMARIES = SHOWCASE_CONVERSATIONS.map((conversation, index) => ({
  _id: `showcase-${conversation.id}`,
  title: conversation.title,
  lastModified: Date.parse('2026-07-22T18:00:00.000Z') - index * 60_000,
  createdAt: Date.parse('2026-07-22T17:00:00.000Z') - index * 60_000,
  updatedAt: Date.parse('2026-07-22T18:00:00.000Z') - index * 60_000,
  lastMode: 'act' as const,
  askModelIds: ['openrouter/free'],
  actModelId: 'openrouter/free',
}))

export const SHOWCASE_CHAT_SNAPSHOTS = Object.fromEntries(
  SHOWCASE_CONVERSATIONS.map((conversation) => [
    `showcase-${conversation.id}`,
    {
      status: 'ok' as const,
      messages: conversation.messages.map((message, index) => ({
        id: `${message.id}-message`,
        turnId: `${conversation.id}-turn-${Math.floor(index / 2)}`,
        mode: 'act' as const,
        role: message.role,
        parts: [{ type: 'text', text: message.text }],
        model: message.role === 'assistant' ? 'openrouter/free' : undefined,
        status: 'completed' as const,
      })),
      outputs: [],
      meta: {
        title: conversation.title,
        lastMode: 'act' as const,
        askModelIds: ['openrouter/free'],
        actModelId: 'openrouter/free',
      },
    },
  ]),
)

export const SHOWCASE_FILES: ShowcaseFile[] = [
  {
    id: 'launch-note',
    name: 'Start here.md',
    kind: 'note',
    content: `# Overlay, explained by Overlay\n\nThis public workspace is the product—not a video of it. Browse its chats, inspect real file viewers, open projects, and see how extensions and automations fit together.\n\n## The idea\n\nAI should feel like one coherent layer across your work. Your models, knowledge, tools, permissions, and deployment choices should remain yours.`,
  },
  {
    id: 'brief',
    name: 'Launch brief.txt',
    kind: 'file',
    content: 'Goal: help a new visitor understand Overlay by using it.\nPrinciple: show one complete outcome before explaining every capability.\nAudience: people and teams who want a coherent, open AI workspace.',
  },
  {
    id: 'metrics',
    name: 'Activation metrics.csv',
    kind: 'file',
    content: 'Step,Visitors,Completion\nOpened workspace,1000,100%\nOpened example,740,74%\nAsked a question,510,51%\nConnected a source,310,31%\nCompleted first task,240,24%',
  },
  {
    id: 'report',
    name: 'Private AI report.pdf',
    kind: 'file',
    content: 'Private AI deployment report\n\nOrganizations generally choose among hosted private cloud, customer VPC, and on-premises deployment. The right architecture preserves model portability, access control, and auditable tool use.',
    url: '/showcase/private-ai-report.pdf',
  },
  {
    id: 'memo',
    name: 'Customer research.docx',
    kind: 'file',
    content: 'Customer research: teams value one interface, durable context, provider choice, and clear control over actions.',
    url: '/showcase/customer-research.docx',
  },
  {
    id: 'sheet',
    name: 'Launch plan.xlsx',
    kind: 'file',
    content: 'Workstream,Owner,Status\nPositioning,Product,Ready\nShowcase,Design,In progress\nLaunch,Marketing,Planned',
  },
  {
    id: 'prototype',
    name: 'Prototype.html',
    kind: 'file',
    content: '<!doctype html><html><body style="font-family:system-ui;padding:40px;background:#f7f7f5;color:#181818"><p style="font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#777">Sandboxed output</p><h1 style="max-width:520px">One workspace for every way you work with AI.</h1><p style="max-width:520px;line-height:1.6">This HTML runs in the real shared file viewer with a restrictive sandbox.</p></body></html>',
  },
  { id: 'visual', name: 'Launch visual.svg', kind: 'file', content: FILE_PARITY_IMAGE_DATA_URL },
  { id: 'audio', name: 'Voice note.wav', kind: 'file', content: FILE_PARITY_AUDIO_DATA_URL },
  { id: 'video', name: 'Product story.mp4', kind: 'file', content: FILE_PARITY_VIDEO_DATA_URL },
]

const SHOWCASE_FILE_TIMESTAMP = Date.parse('2026-07-22T18:00:00.000Z')

export const SHOWCASE_KNOWLEDGE_NODES: KnowledgeSurfaceNode[] = SHOWCASE_FILES.map((file, index) => {
  const extension = file.name.split('.').pop()?.toLowerCase()
  return normalizeKnowledgeSurfaceNode({
    _id: `showcase-file-${file.id}`,
    name: file.name,
    type: 'file',
    kind: file.kind === 'note' ? 'note' : 'file',
    parentId: null,
    textContent: file.content,
    content: file.content,
    downloadUrl: file.url,
    extension,
    mimeType:
      extension === 'pdf' ? 'application/pdf'
      : extension === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : extension === 'csv' ? 'text/csv'
      : extension === 'html' ? 'text/html'
      : extension === 'svg' ? 'image/svg+xml'
      : extension === 'wav' ? 'audio/wav'
      : extension === 'mp4' ? 'video/mp4'
      : 'text/plain',
    createdAt: SHOWCASE_FILE_TIMESTAMP - index * 60_000,
    updatedAt: SHOWCASE_FILE_TIMESTAMP - index * 60_000,
  })
})

export const SHOWCASE_CONNECTORS: ConnectorCatalogItem[] = [
  { id: 'gmail', providerKey: 'gmail', slug: 'gmail', name: 'Gmail', description: 'Search, draft, and send email', icon: '', logoUrl: 'https://api.iconify.design/logos:google-gmail.svg', isConnected: true },
  { id: 'drive', providerKey: 'googledrive', slug: 'googledrive', name: 'Google Drive', description: 'Find and work with files', icon: '', logoUrl: 'https://api.iconify.design/logos:google-drive.svg', isConnected: true },
  { id: 'linear', providerKey: 'linear', slug: 'linear', name: 'Linear', description: 'Create and update issues', icon: '', logoUrl: 'https://api.iconify.design/logos:linear-icon.svg', isConnected: true },
  { id: 'notion', providerKey: 'notion', slug: 'notion', name: 'Notion', description: 'Search and create pages', icon: '', logoUrl: 'https://api.iconify.design/logos:notion-icon.svg' },
  { id: 'slack', providerKey: 'slack', slug: 'slack', name: 'Slack', description: 'Read channels and send messages', icon: '', logoUrl: 'https://api.iconify.design/logos:slack-icon.svg' },
  { id: 'github', providerKey: 'github', slug: 'github', name: 'GitHub', description: 'Inspect repositories and manage work', icon: '', logoUrl: 'https://api.iconify.design/logos:github-icon.svg' },
]

export const SHOWCASE_PROJECTS = [
  { id: 'launch', name: 'Overlay launch', description: 'Positioning, research, launch assets, and the public product story.', resources: ['Start here.md', 'Activation metrics.csv', 'Research with sources'] },
  { id: 'private-ai', name: 'Private AI deployment', description: 'A reusable workspace for evaluating customer VPC and on-premises deployments.', resources: ['Private AI report.pdf', 'Customer research.docx', 'Launch plan.xlsx'] },
] as const

export const SHOWCASE_AUTOMATIONS = [
  { id: 'briefing', name: 'Daily customer briefing', schedule: 'Weekdays at 8:00 AM', description: 'Summarize priority email, meetings, and open customer issues.', enabled: true },
  { id: 'research', name: 'Weekly market watch', schedule: 'Mondays at 9:00 AM', description: 'Research product updates and save a cited report to the launch project.', enabled: true },
  { id: 'followup', name: 'Meeting follow-up', schedule: 'After every recorded meeting', description: 'Extract decisions, draft follow-ups, and create reviewable tasks.', enabled: false },
] as const

export const SHOWCASE_SKILLS = [
  ['Executive brief', 'Turn research and source material into a concise decision memo.'],
  ['Launch writer', 'Apply the product voice and clarity-over-cleverness writing principle.'],
  ['Data analyst', 'Inspect tables, explain anomalies, and recommend the next question.'],
] as const

export const SHOWCASE_MCPS = [
  ['Browser tools', 'Search, navigate, and extract structured information.'],
  ['Sandbox runtime', 'Run code and inspect generated artifacts in an isolated environment.'],
] as const
