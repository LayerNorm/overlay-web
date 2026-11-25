// Workspace and Personal after P2–P7 of internal/plans/WORKSPACE_PERSONAL_SEPARATION_PLAN.md, on the production shell:
// - The rail switch, agent lists and Personal Chief are production now (PR 617); this feature adds their sample data.
// - Moves go one way and are confirmed; moving an automation checks its agent and accounts, and a personal Gmail is
//   replaced by connecting one for the workspace.
// - The bar switches section and today/proposed.
//   MOCKUP_FEATURE=workspace-personal node internal/plans/mockups/overlay-app/build.mjs
import { fileURLToPath } from 'node:url'

const file = (name) => JSON.stringify(fileURLToPath(new URL('./' + name, import.meta.url)))

export default {
  out: 'workspace-personal.html',
  title: 'Overlay | Workspace and Personal mockup',
  patches: [
    {
      file: 'internal/plans/mockups/overlay-app/entry.tsx',
      imports: `import { installWorkspacePersonalFixtures } from ${file('fixtures.ts')}\nimport { mountMockupBar } from ${file('components.tsx')}\n`,
      replace: [['installFixtures()\n', 'installFixtures()\ninstallWorkspacePersonalFixtures()\nmountMockupBar()\n']],
    },
    {
      // One-way, confirmed moves.
      file: 'src/components/layout/ScopeItemActions.tsx',
      imports: `import { proposedMoveTo, requestMove } from ${file('components.tsx')}\nimport { PROPOSED as ONE_WAY } from ${file('model.ts')}\n`,
      replace: [
        ['  if (options.moveTo) {\n    const to = options.moveTo', '  const proposedTo = proposedMoveTo(options.moveTo)\n  if (proposedTo) {\n    const to = proposedTo'],
        [
          "onClick: () => void run({ action: 'move', to }, () => actions.move(item._id, to)),",
          "onClick: () => ONE_WAY ? requestMove(resource, item as never) : void run({ action: 'move', to }, () => actions.move(item._id, to)),",
        ],
      ],
    },
  ],
}
