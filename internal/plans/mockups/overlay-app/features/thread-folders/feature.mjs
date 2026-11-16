// Real thread-folder components (internal/develop/thread-folders.md) in the app shell, for visual QA:
//   MOCKUP_FEATURE=thread-folders node internal/plans/mockups/overlay-app/build.mjs
import { fileURLToPath } from 'node:url'

const fixtures = JSON.stringify(fileURLToPath(new URL('./fixtures.ts', import.meta.url)))

export default {
  out: 'thread-folders.html',
  title: 'Overlay | Thread folders',
  patches: [
    {
      file: 'internal/plans/mockups/overlay-app/entry.tsx',
      imports: `import { installThreadFolderFixtures } from ${fixtures}\n`,
      replace: [['installFixtures()\n', 'installFixtures()\ninstallThreadFolderFixtures()\n']],
    },
  ],
}
