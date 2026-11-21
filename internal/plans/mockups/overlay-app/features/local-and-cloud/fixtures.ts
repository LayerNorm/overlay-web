import type { DesktopBridge, LocalComputerStatus } from '@overlay/desktop-bridge'
import { defineMutations, defineQueries, notifyFixtures } from '../../fixtures/convex'
import { route } from '../../fixtures/fetch'
import { MIN, ROOMS, agentRoom, message, text, tool } from '../../fixtures/rooms'
import { VIEWER_PRINCIPAL } from '../../fixtures/agents'
import { THREAD_WORK_LOCKED, sameThreadWork, type ThreadWork } from '../../../../../../src/shared/agents/thread-work'
import { HOST, LOCAL_THREAD_ID, NEW_THREAD_ID, SETUP } from './model'

/**
 * Stand-ins for what the production Local and Cloud code talks to: the thread-work queries, the computer routes and
 * the desktop app's bridge. The folder dialog is the browser's real one; everything else answers from memory.
 */

const HOME = '/Users/mercedes'
const WORK = `${HOME}/Overlay Files`
const ENVIRONMENT_ID = 'env_macbook_pro'
const LAUNCH = 'k17folderlaunch00000000000000000'

type Environment = Record<string, unknown> & { id: string; status: string; filesystemGrant?: { mode: 'selected_roots'; roots: string[] }; verificationPhrase?: string }

const connected = (roots: string[]): Environment => ({
  id: ENVIRONMENT_ID, workspaceId: 'ws_northwind', kind: 'local', name: 'MacBook Pro', status: 'online',
  // Far enough ahead that the app's "seen recently" check keeps it online while the mockup is open.
  lastSeenAt: Date.now() + 365 * 24 * 60 * MIN, capabilities: { localTools: { version: 1 } },
  filesystemGrant: { mode: 'selected_roots', roots }, approvedByUserId: 'user_mercedes', createdAt: Date.now(), updatedAt: Date.now(),
})

const done = SETUP === 'done'
let environments: Environment[] = done ? [connected([WORK, `${HOME}/code/northwind-web`, `${HOME}/code/homepage-experiments`])] : []
const desktop = { environmentId: done ? ENVIRONMENT_ID : null as string | null, running: done, phrase: null as string | null }
const work = new Map<string, ThreadWork>(done
  ? [[LOCAL_THREAD_ID, { computer: { kind: 'mac', environmentId: ENVIRONMENT_ID }, folders: [{ source: 'mac', environmentId: ENVIRONMENT_ID, path: `${HOME}/code/northwind-web` }] }]]
  : [])

/** Lets another feature mockup add its own thread's computer and folder. */
export const addThreadWork = (conversationId: string, next: ThreadWork) => work.set(conversationId, next)
const started = (conversationId: string) => (ROOMS.find((room) => room.id === conversationId)?.messages.length ?? 0) > 0
const usable = () => environments.filter((environment) => environment.status !== 'pending' && environment.status !== 'revoked')

function installThreadWork() {
  defineQueries({
    'agents/threadWork:get': ({ conversationId }: Record<string, unknown>) => work.get(String(conversationId)) ?? { folders: [] },
    'agents/threadWork:options': () => ({
      cloud: { status: 'ready', name: null },
      localComputer: true,
      macs: usable().map((environment) => ({
        environmentId: environment.id, name: environment.name, status: environment.status, lastSeenAt: environment.lastSeenAt,
        roots: environment.filesystemGrant?.roots ?? [], allFiles: false,
      })),
      folders: [
        { fileId: LAUNCH, name: 'Launch', path: 'Launch', scope: 'workspace' },
        { fileId: 'k17folderresearch000000000000000', name: 'Research', path: 'Research', scope: 'workspace' },
        { fileId: 'k17folderpersonal00000000000000a', name: 'Drafts', path: 'Drafts', scope: 'personal' },
      ],
      githubConnected: true,
    }),
    'agents/environmentsBrowse:list': () => environments,
  })
  defineMutations({
    'agents/threadWork:set': ({ conversationId, work: next }: { conversationId: string; work: ThreadWork }) => {
      const current = work.get(conversationId) ?? { folders: [] }
      if (sameThreadWork(current, next)) return current
      if (started(conversationId)) throw new Error(THREAD_WORK_LOCKED)
      work.set(conversationId, next)
      return next
    },
  })
}

function installRoutes() {
  const one = (path: string) => environments.find((environment) => environment.id === decodeURIComponent(path.split('/')[4] ?? ''))
  const grant = (body: unknown) => (body as { filesystemGrant: { mode: 'selected_roots'; roots: string[] } }).filesystemGrant
  route('GET', /^\/api\/v1\/agent-environments$/, () => ({ environments }))
  route('POST', /^\/api\/v1\/agent-environments\/enrollment-sessions$/, () => ({ enrollmentSessionId: 'session', code: 'mockup-code-123', command: '', expiresAt: Date.now() + 10 * MIN }))
  route('POST', /^\/api\/v1\/agent-environments\/[^/]+\/approve$/, ({ path, body }) => {
    const pending = one(path)!
    environments = environments.map((environment) => (environment === pending ? connected(grant(body).roots) : environment))
    desktop.environmentId = ENVIRONMENT_ID
    notifyFixtures()
    return { environment: environments[0] }
  })
  route('PATCH', /^\/api\/v1\/agent-environments\/[^/]+\/roots$/, ({ path, body }) => {
    const environment = one(path)!
    environment.filesystemGrant = grant(body)
    environments = [...environments]
    notifyFixtures()
    return { environment }
  })
  route('POST', /^\/api\/v1\/agent-environments\/[^/]+\/copy-to-files$/, () => ({ folderId: LAUNCH, copied: 42, skipped: ['node_modules'] }))
  route('GET', /^\/api\/v1\/github\/repositories$/, () => ({ configured: true, repositories: [
    { repository: 'northwind/northwind-web', installationId: 7, private: true, defaultBranch: 'main' },
    { repository: 'northwind/northwind-api', installationId: 7, private: true, defaultBranch: 'main' },
  ] }))
  // Sending really adds the message, so a thread starts and its computer and folder become fixed.
  route('POST', /^\/api\/v1\/conversations\/message$/, ({ body }) => {
    const request = (body ?? {}) as { conversationId?: string; content?: string; turnId?: string; messageId?: string }
    const room = ROOMS.find((entry) => entry.id === request.conversationId)
    if (!room || !request.content) return { success: false }
    const sent = message(room.id, VIEWER_PRINCIPAL, 0, request.content)
    if (request.turnId) sent.turnId = request.turnId
    if (request.messageId) sent.id = request.messageId
    room.messages.push(sent)
    room.lastModified = Date.now()
    notifyFixtures()
    return { success: true, conversationId: room.id, turnId: sent.turnId, messageId: sent.id }
  })
}

/** The system's folder dialog. A browser only reveals the folder's name, so the mockup places it in the home folder. */
async function chooseFolder(): Promise<{ path: string } | null> {
  const showDirectoryPicker = (window as unknown as { showDirectoryPicker?: () => Promise<{ name: string }> }).showDirectoryPicker
  if (!showDirectoryPicker) return { path: `${HOME}/code/northwind-api` }
  try {
    return { path: `${HOME}/${(await showDirectoryPicker.call(window)).name}` }
  } catch {
    return null
  }
}

/** The desktop app: only the parts This computer uses, so Settings → Desktop shows just that section. */
function installDesktopApp() {
  const status = (): LocalComputerStatus => ({
    hostState: desktop.running ? 'running' : 'idle', localTools: desktop.running, verificationPhrase: desktop.phrase,
    keepAvailable: desktop.running, homeDirectory: HOME, computerName: 'MacBook Pro', environmentId: desktop.environmentId,
    workFolder: WORK, permissions: { accessibility: true, screenRecording: false },
  })
  const answers: Record<string, (input: never) => unknown> = {
    'localComputer.status': status,
    'localComputer.chooseFolder': chooseFolder,
    'localComputer.requestPermission': status,
    'localComputer.setKeepAvailable': ({ enabled }: { enabled: boolean }) => { desktop.running = enabled; return status() },
    'agentHost.start': () => {
      desktop.running = true
      desktop.phrase = 'calm-river-stone'
      environments = [...environments, { id: 'env_pending', workspaceId: 'ws_northwind', kind: 'local', name: 'MacBook Pro', status: 'pending', verificationPhrase: desktop.phrase }]
      notifyFixtures()
      return { state: 'running', pid: 4242, logTail: [] }
    },
    'agentHost.stop': () => { desktop.running = false; return { state: 'idle', pid: null, logTail: [] } },
    'agentHost.status': () => ({ state: desktop.running ? 'running' : 'idle', pid: null, logTail: [] }),
    'agentHost.logs': () => ['Starting embedded agent host…', 'local tools ready'],
  }
  const bridge: DesktopBridge = {
    handshake: async () => ({ bridgeVersion: 1, appVersion: '0.3.0', platform: 'darwin', surface: 'main', capabilities: ['window', 'localComputer', 'agentHost'] }),
    call: (async (method: string, input: never) => {
      const answer = answers[method]
      if (!answer) throw new Error(`Not available in the mockup: ${method}`)
      return answer(input)
    }) as DesktopBridge['call'],
    on: () => () => {},
  }
  ;(window as unknown as { overlayDesktop: DesktopBridge }).overlayDesktop = bridge
}

export function installLocalCloudFixtures() {
  installThreadWork()
  installRoutes()
  if (HOST === 'desktop') installDesktopApp()
  ROOMS.push(agentRoom(NEW_THREAD_ID, 'agent_atlas', 'New thread', 1 * MIN, 'ready', () => []))
  if (!done) return
  ROOMS.push(agentRoom(LOCAL_THREAD_ID, 'agent_atlas', 'Fix the flaky checkout test', 4 * MIN, 'ready', (room, atlas) => [
    message(room, VIEWER_PRINCIPAL, 21 * MIN, 'The checkout test fails about one run in five. Can you find out why and fix it?'),
    message(room, atlas, 4 * MIN, 'The test clicked Pay before the totals finished loading. It now waits for the total, and it passed 20 runs in a row.', [
      tool('l1', 'computer_exec', { command: 'git status --short' }, { success: true, exitCode: 0 }),
      tool('l2', 'computer_read_file', { path: '~/code/northwind-web/tests/checkout.spec.ts' }, { success: true }),
      tool('l3', 'computer_write_file', { path: '~/code/northwind-web/tests/checkout.spec.ts' }, { success: true, created: false, linesAdded: 6, linesRemoved: 2 }),
      tool('l4', 'computer_exec', { command: 'npx playwright test checkout --repeat-each=20' }, { success: true, exitCode: 0 }),
      text('The test clicked **Pay** before the totals finished loading. It now waits for the total, and it passed 20 runs in a row.'),
    ]),
  ]))
}
