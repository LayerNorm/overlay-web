// The agent sidebars: the right panel's home (avatar, then Settings, Computer and the thread's panels, also shown by
// "+"), at most five threads per agent with "Load more", and chief tiles that are never shown selected. Everything
// comes from the production components on this branch; this feature only adds fixtures: both chiefs side by side,
// enough threads to pass five, and a relay thread mid-run.
//   MOCKUP_FEATURE=agent-sidebar-panels node internal/plans/mockups/overlay-app/build.mjs
import { fileURLToPath } from 'node:url'

const fixtures = JSON.stringify(fileURLToPath(new URL('./fixtures.ts', import.meta.url)))

export default {
  out: 'agent-sidebar-panels.html',
  title: 'Overlay | Agent sidebars mockup',
  patches: [
    {
      file: 'internal/plans/mockups/overlay-app/entry.tsx',
      imports: `import { installAgentWorkingFixtures } from ${fixtures}\n`,
      replace: [['installFixtures()\n', 'installFixtures()\ninstallAgentWorkingFixtures()\n']],
    },
  ],
}
