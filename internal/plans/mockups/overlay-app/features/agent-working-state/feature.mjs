// The agent working state, now in production: the working orb on running tool rows, the bottom working line, the
// pinned chief tiles and even response spacing all come from the real components. This feature only adds fixtures:
// a relay thread mid-run, a settled response with assignments, and the viewer's own chief beside the workspace one.
//   MOCKUP_FEATURE=agent-working-state node internal/plans/mockups/overlay-app/build.mjs
import { fileURLToPath } from 'node:url'

const fixtures = JSON.stringify(fileURLToPath(new URL('./fixtures.ts', import.meta.url)))

export default {
  out: 'agent-working-state.html',
  title: 'Overlay | Agent working state mockup',
  patches: [
    {
      file: 'internal/plans/mockups/overlay-app/entry.tsx',
      imports: `import { installAgentWorkingFixtures } from ${fixtures}\n`,
      replace: [['installFixtures()\n', 'installFixtures()\ninstallAgentWorkingFixtures()\n']],
    },
  ],
}
