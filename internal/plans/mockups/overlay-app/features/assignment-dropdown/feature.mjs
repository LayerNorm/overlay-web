// Chief assignments as a plain dropdown row inside the response that made them, styled like the tool-call and
// "Worked for" rows, with the assignment (branch) icon. Reuses the chief-assignments sample conversations.
//   MOCKUP_FEATURE=assignment-dropdown node internal/plans/mockups/overlay-app/build.mjs
import { fileURLToPath } from 'node:url'

const components = JSON.stringify(fileURLToPath(new URL('./components.tsx', import.meta.url)))
const fixtures = JSON.stringify(fileURLToPath(new URL('../chief-assignments/fixtures.ts', import.meta.url)))

export default {
  out: 'assignment-dropdown.html',
  title: 'Overlay | Assignment dropdown mockup',
  patches: [
    {
      file: 'internal/plans/mockups/overlay-app/entry.tsx',
      imports: `import { installChiefAssignmentFixtures } from ${fixtures}\nimport { mountMockupBar } from ${components}\n`,
      replace: [['installFixtures()\n', 'installFixtures()\ninstallChiefAssignmentFixtures()\nmountMockupBar()\n']],
    },
    {
      // The row replaces the assignment box in the response's text column.
      file: 'src/features/chat/components/collaboration/RoomMessageItem.tsx',
      imports: `import { AssignmentDropdown } from ${components}\n`,
      replace: [[
        '{isAgent ? <ResponseAssignments messageId={message.id} /> : null}',
        '{isAgent ? <AssignmentDropdown messageId={message.id} /> : null}',
      ]],
    },
  ],
}
