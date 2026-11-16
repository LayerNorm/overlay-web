// Local and Cloud (internal/develop/thread-folders.md): the production thread controls and Settings → Desktop →
// This computer, rendered with sample data and a stand-in for the desktop app, for visual QA.
//   MOCKUP_FEATURE=local-and-cloud node internal/plans/mockups/overlay-app/build.mjs
import { fileURLToPath } from 'node:url'

const components = JSON.stringify(fileURLToPath(new URL('./components.tsx', import.meta.url)))
const fixtures = JSON.stringify(fileURLToPath(new URL('./fixtures.ts', import.meta.url)))

const feature = {
  out: 'local-and-cloud.html',
  title: 'Overlay | Local and Cloud mockup',
  patches: [
    {
      // Sample threads, the server's answers, the stand-in desktop app, and the bar that switches web/desktop.
      file: 'internal/plans/mockups/overlay-app/entry.tsx',
      imports: `import { installLocalCloudFixtures } from ${fixtures}\nimport { mountHostChrome } from ${components}\n`,
      replace: [['installFixtures()\n', 'installFixtures()\ninstallLocalCloudFixtures()\nmountHostChrome()\n']],
    },
  ],
}

export default feature
