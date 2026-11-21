// Private local threads (internal/plans/LOCAL_PRIVATE_THREADS_PLAN.md, Phase 0): a Cloud sync choice beside where an
// agent thread runs and its folder. Built on the Local and Cloud mockup's sample data and stand-in desktop app.
//   MOCKUP_FEATURE=private-threads node internal/plans/mockups/overlay-app/build.mjs
import { fileURLToPath } from 'node:url'

const components = JSON.stringify(fileURLToPath(new URL('./components.tsx', import.meta.url)))
const fixtures = JSON.stringify(fileURLToPath(new URL('./fixtures.ts', import.meta.url)))
const hostChrome = JSON.stringify(fileURLToPath(new URL('../local-and-cloud/components.tsx', import.meta.url)))

export default {
  out: 'private-threads.html',
  title: 'Overlay | Private threads mockup',
  patches: [
    {
      // Sample threads (one not synced), the stand-in desktop app, the window bar and the Sync to cloud dialog.
      file: 'internal/plans/mockups/overlay-app/entry.tsx',
      imports: `import { installPrivateThreadFixtures } from ${fixtures}\nimport { mountHostChrome } from ${hostChrome}\nimport { mountSyncDialog } from ${components}\n`,
      replace: [['installFixtures()\n', 'installFixtures()\ninstallPrivateThreadFixtures()\nmountHostChrome()\nmountSyncDialog()\n']],
    },
    {
      // This mockup opens with this computer already connected.
      file: 'internal/plans/mockups/overlay-app/features/local-and-cloud/model.ts',
      replace: [[`params.get('setup') === 'done' ? 'done' : 'first'`, `params.get('setup') === 'first' ? 'first' : 'done'`]],
    },
    {
      // The Cloud sync choice beside This computer and the folder, and its fixed label once the thread has started.
      file: 'src/features/chat/components/thread-work/ThreadWorkFooter.tsx',
      imports: `import { CloudSyncChoice, NotSyncedLabel } from ${components}\n`,
      replace: [
        [`      </DropdownMenu>\n      <span className="flex-1" />`, `      </DropdownMenu>\n      {local ? <CloudSyncChoice disabled={connecting} /> : null}\n      <span className="flex-1" />`],
        [`<span className="truncate">{folder ? folderLabel(folder) : 'No folder'}</span></Fixed>\n`, `<span className="truncate">{folder ? folderLabel(folder) : 'No folder'}</span></Fixed>\n        {desktop && local ? <NotSyncedLabel /> : null}\n`],
      ],
    },
    {
      // Threads that are not synced carry a small mark in the agent's thread list.
      file: 'src/components/layout/AppSidebarAgentThreads.tsx',
      imports: `import { NotSyncedMark } from ${components}\n`,
      replace: [[
        `<span className="flex-1 truncate">{thread.title}</span>\n            </ThreadButton>`,
        `<span className="flex-1 truncate">{thread.title}</span>\n              <NotSyncedMark conversationId={thread.conversationId} />\n            </ThreadButton>`,
      ]],
    },
    {
      // Sync to cloud, one way, in the thread's options menu.
      file: 'src/features/chat/components/DirectMessageExperience.parts.tsx',
      imports: `import { SyncToCloudMenuItem } from ${components}\n`,
      replace: [[
        `        <MenuButton\n          icon={Archive}\n          label={currentParticipant?.archivedAt ? 'Restore' : 'Archive'}`,
        `        <SyncToCloudMenuItem MenuButton={MenuButton} close={() => setMenuOpen(false)} />\n        <MenuButton\n          icon={Archive}\n          label={currentParticipant?.archivedAt ? 'Restore' : 'Archive'}`,
      ]],
    },
  ],
}
