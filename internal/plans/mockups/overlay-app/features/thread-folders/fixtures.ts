import { defineMutations, defineQueries, notifyFixtures } from '../../fixtures/convex'
import { HOUR, MIN, NOW, ROOMS, agentRoom, message, text } from '../../fixtures/rooms'
import { VIEWER_PRINCIPAL } from '../../fixtures/agents'
import type { ThreadWork } from '../../../../../../src/shared/agents/thread-work'
import type { FolderSavesData } from '../../../../../../src/shared/agents/folder-saves'

/** Answers for the real thread-folder components (internal/develop/thread-folders.md): pickers and the saved card. */

export const THREAD_ID = 'k17convatlasfolders0000000000000'
const LAUNCH = 'k17folderlaunch00000000000000000'

const work = new Map<string, ThreadWork>([[THREAD_ID, { computer: { kind: 'cloud' }, folders: [{ source: 'overlay', fileId: LAUNCH, name: 'Launch' }] }]])

const saves: FolderSavesData = {
  version: 1,
  folders: [{
    folderId: LAUNCH, folderName: 'Launch',
    saved: [
      { path: 'Launch FAQ.md', action: 'created', fileId: 'n1' },
      { path: 'Launch plan.md', action: 'updated', fileId: 'n2' },
      { path: 'Pricing benchmark.md', action: 'saved_as_copy', fileId: 'n3' },
      { path: 'drafts/old outline.md', action: 'deleted', fileId: 'n4' },
    ],
    failed: [],
    skipped: ['node_modules'],
  }],
  pullRequests: [],
}

export function installThreadFolderFixtures() {
  defineQueries({
    'agents/threadWork:get': ({ conversationId }: Record<string, unknown>) => work.get(String(conversationId)) ?? { folders: [] },
    'agents/threadWork:options': () => ({
      cloud: { status: 'ready', name: null },
      macs: [
        { environmentId: 'mac-mbp', name: 'MacBook Pro', status: 'online', lastSeenAt: Date.now(), roots: ['/Users/mercedes/code/homepage-experiments'], allFiles: false },
        { environmentId: 'mac-studio', name: 'Mac Studio', status: 'online', lastSeenAt: Date.now(), roots: ['/Users/mercedes/dev/northwind-ios'], allFiles: false },
        { environmentId: 'mac-mini', name: 'Mac mini', status: 'online', lastSeenAt: Date.now() - 2 * 24 * HOUR, roots: [], allFiles: false },
      ],
      folders: [
        { fileId: LAUNCH, name: 'Launch', path: 'Launch', scope: 'workspace' },
        { fileId: 'k17folderresearch000000000000000', name: 'Research', path: 'Research', scope: 'workspace' },
        { fileId: 'k17folderpersonal00000000000000a', name: 'Drafts', path: 'Drafts', scope: 'personal' },
      ],
      githubConnected: true,
    }),
  })
  defineMutations({
    'agents/threadWork:set': ({ conversationId, work: next }: { conversationId: string; work: ThreadWork }) => {
      work.set(conversationId, next)
      notifyFixtures()
      return next
    },
  })
  // The GitHub repository list comes from the BFF; answer it here.
  const original = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.includes('/api/v1/github/repositories')) {
      return new Response(JSON.stringify({ configured: true, repositories: [
        { repository: 'northwind/northwind-web', installationId: 7, private: true, defaultBranch: 'main' },
        { repository: 'northwind/northwind-api', installationId: 7, private: true, defaultBranch: 'main' },
      ] }), { headers: { 'Content-Type': 'application/json' } })
    }
    return original(input, init)
  }
  ROOMS.push(agentRoom(THREAD_ID, 'agent_atlas', 'Launch FAQ from the Launch folder', 9 * MIN, 'ready', (room, atlas) => [
    message(room, VIEWER_PRINCIPAL, 40 * MIN, 'Write a launch FAQ from the notes in Launch, and tidy the plan.'),
    message(room, atlas, 9 * MIN, 'The FAQ is in Launch, and the plan now leads with the December 2 date.', [
      text('The FAQ is in **Launch**, and the plan now leads with the December 2 date. You edited the pricing benchmark while I worked, so I kept your version and saved mine beside it.'),
      { type: 'data-folder-saves', data: saves } as never,
    ]),
  ]))
}
