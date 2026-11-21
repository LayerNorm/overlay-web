// Links and computer control in an agent thread's panel, built from the production components on this branch: a link
// opened from the thread is a tab of the panel, taking control streams the computer interactively in the panel (widened),
// the working line's orb lines up with the agent's name, and the primary sidebar leads with Agents and Chats. This
// feature only adds fixtures (a news thread with links, a live reply, Atlas's running computer) and turns on computers
// and opening links in Overlay.
//   MOCKUP_FEATURE=agent-panel-links-and-control node internal/plans/mockups/overlay-app/build.mjs
import { fileURLToPath } from 'node:url'

const fixtures = JSON.stringify(fileURLToPath(new URL('./fixtures.ts', import.meta.url)))

export default {
  out: 'agent-panel-links-and-control.html',
  title: 'Overlay | Links and computer control mockup',
  patches: [
    {
      file: 'internal/plans/mockups/overlay-app/entry.tsx',
      imports: `import { installPanelLinkFixtures } from ${fixtures}\n`,
      replace: [['installFixtures()\n', 'installFixtures()\ninstallPanelLinkFixtures()\n']],
    },
    {
      file: 'internal/plans/mockups/overlay-app/fixtures/workspace.ts',
      replace: [['capabilities: { billing: true }', 'capabilities: { billing: true, computers: true }']],
    },
    {
      file: 'internal/plans/mockups/overlay-app/fixtures/data.ts',
      replace: [["linkOpenPreference: 'in-app'", "linkOpenPreference: 'overlay'"]],
    },
  ],
}
