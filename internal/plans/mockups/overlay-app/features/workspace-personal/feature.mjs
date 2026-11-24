// Workspace and Personal after P2–P7 of internal/plans/WORKSPACE_PERSONAL_SEPARATION_PLAN.md, on the production shell:
// - One Workspace | Personal switch at the top of the primary rail (Workspace by default) instead of one per section.
// - "Overlay" is the workspace chief only; the personal chief is "Mercedes's Chief" and is listed only in Personal.
//   Personal agents are creator-only agents.
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
      // The mode switch moves from each section's panel to the top of the primary rail.
      file: 'packages/overlay-shell-react/src/sidebar/DoubleSidebar.tsx',
      imports: `import { RailModeSwitch } from ${file('components.tsx')}\nimport { PROPOSED as RAIL_MODE } from ${file('model.ts')}\n`,
      replace: [
        ['{!settingsNav ? <ScopeToggle', '{!settingsNav && !RAIL_MODE ? <ScopeToggle'],
        [
          '<div className="-mb-px flex size-10 shrink-0 items-center justify-center">{railBrand}</div>',
          '<div className="-mb-px flex size-10 shrink-0 items-center justify-center">{railBrand}</div>\n        <RailModeSwitch scope={scope} onChange={(next) => { if (next !== scope) { if (scopedNav) scopedNav.onSelect(next); else rememberScope(next) } }} />',
        ],
      ],
    },
    {
      file: 'packages/overlay-shell-react/src/sidebar/UnifiedSidebar.tsx',
      imports: `import { PROPOSED as RAIL_MODE } from ${file('model.ts')}\n`,
      replace: [['{collapsed || settingsNav ? null : <ScopeToggle', '{collapsed || settingsNav || RAIL_MODE ? null : <ScopeToggle']],
    },
    {
      // Workspace lists the workspace Overlay and workspace-visible agents; Personal lists the Personal Chief and
      // creator-only agents.
      file: 'src/components/layout/AppSidebarAgentsPanel.tsx',
      imports: `import { PROPOSED as BY_MODE, agentsForMode } from ${file('model.ts')}\n`,
      replace: [[
        '() => agentsForCreatorScope(\n      previewedAgents.filter((agent) => !agent.archivedAt),',
        '() => BY_MODE ? agentsForMode(previewedAgents.filter((agent) => !agent.archivedAt), viewerPrincipalId, view) : agentsForCreatorScope(\n      previewedAgents.filter((agent) => !agent.archivedAt),',
      ], [
        // A lone chief tile grows to fit its name ("Mercedes's Chief"), from half the panel up to all of it.
        "${pinnedAlone ? 'mx-auto w-1/2' : ''}",
        "${pinnedAlone ? 'mx-auto w-fit min-w-1/2 max-w-full' : ''}",
      ]],
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
