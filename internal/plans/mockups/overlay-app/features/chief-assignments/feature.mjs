// Chief assignments: the assignment box inside the response that made it, an Assignments list in the right panel of
// agent threads, chats and channels, and how a delegated agent that cannot run is reported.
//   MOCKUP_FEATURE=chief-assignments node internal/plans/mockups/overlay-app/build.mjs
import { fileURLToPath } from 'node:url'

const components = JSON.stringify(fileURLToPath(new URL('./components.tsx', import.meta.url)))
const fixtures = JSON.stringify(fileURLToPath(new URL('./fixtures.ts', import.meta.url)))

export default {
  out: 'chief-assignments.html',
  title: 'Overlay | Chief assignments mockup',
  patches: [
    {
      // Sample conversations and the bar that switches conversation and today/proposed.
      file: 'internal/plans/mockups/overlay-app/entry.tsx',
      imports: `import { installChiefAssignmentFixtures } from ${fixtures}\nimport { mountMockupBar } from ${components}\n`,
      replace: [['installFixtures()\n', 'installFixtures()\ninstallChiefAssignmentFixtures()\nmountMockupBar()\n']],
    },
    {
      // The box sits in the response's text column, under the text it belongs to.
      file: 'src/features/chat/components/collaboration/RoomMessageItem.tsx',
      imports: `import { ResponseAssignments } from ${components}\n`,
      replace: [[
        `          <HumanMessageText message={message} />
        )}
        {content.chatActions ? null : (`,
        `          <HumanMessageText message={message} />
        )}
        <ResponseAssignments messageId={message.id} />
        {content.chatActions ? null : (`,
      ]],
    },
    {
      // Agent thread: an Assignments tab beside Details, Library and Computer.
      file: 'src/features/agents/components/AgentRightSidebar.tsx',
      imports: `import { assignmentsTab } from ${components}\n`,
      replace: [[
        `    {
      id: 'library',
      label: 'Library',`,
        `    ...assignmentsTab(conversationId, selectedTab),
    {
      id: 'library',
      label: 'Library',`,
      ]],
    },
    {
      file: 'src/features/agents/components/AgentConversationWorkspace.tsx',
      replace: [[`if (id !== 'details' && id !== 'library' && id !== 'computer') return`, `if (id !== 'details' && id !== 'library' && id !== 'computer' && id !== 'assignments') return`]],
    },
    {
      file: 'src/shared/agents/agent-right-sidebar-preferences.ts',
      replace: [[`['details', 'library', 'computer']`, `['details', 'library', 'computer', 'assignments' as never]`]],
    },
    {
      // Chats and channels: an Assignments panel beside People and Pinned.
      file: 'src/features/chat/components/DirectMessageExperience.tsx',
      replace: [
        [`room.roomPanel === 'people' || room.roomPanel === 'pinned'`, `room.roomPanel === 'people' || room.roomPanel === 'pinned' || (room.roomPanel as string) === 'assignments'`],
        [`return roomPanel === 'people' || roomPanel === 'pinned'`, `return roomPanel === 'people' || roomPanel === 'pinned' || roomPanel === 'assignments'`],
      ],
    },
    {
      file: 'src/features/chat/components/DirectMessageExperience.parts.tsx',
      imports: `import { AssignmentsPanelButton, AssignmentsRoomPanel } from ${components}\n`,
      replace: [
        [
          `      <Button
        variant="ghost"
        type="button"
        onClick={() => setRoomPanel((current) => (current === 'people' ? null : 'people'))}`,
          `      <AssignmentsPanelButton roomPanel={roomPanel} setRoomPanel={setRoomPanel as never} />
      <Button
        variant="ghost"
        type="button"
        onClick={() => setRoomPanel((current) => (current === 'people' ? null : 'people'))}`,
        ],
        [
          `  if (roomPanel === 'people') {
    return (
      <RoomPeoplePanel`,
          `  if ((roomPanel as string) === 'assignments') return <AssignmentsRoomPanel onClose={onClosePanel} />
  if (roomPanel === 'people') {
    return (
      <RoomPeoplePanel`,
        ],
      ],
    },
  ],
}
