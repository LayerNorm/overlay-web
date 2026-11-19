// Chief assignments and the tabbed right sidebar: the assignment box inside the response that made it, one sidebar for
// agent threads, chats and channels whose views open as tabs, and how a delegated agent that cannot run is reported.
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
      // Agent thread: the tabbed sidebar, with Assignments among its views and the avatar on top.
      file: 'src/features/agents/components/AgentRightSidebar.tsx',
      imports: `import { TabbedRightSidebar, assignmentsTab, useAgentSidebarView } from ${components}\n`,
      replace: [
        [`  const selectedTab = activeTab\n`, `  const selectedTab = useAgentSidebarView(activeTab)\n`],
        [
          `    {
      id: 'library',
      label: 'Library',`,
          `    ...assignmentsTab(conversationId, selectedTab),
    {
      id: 'library',
      label: 'Library',`,
        ],
        [`    <RightSidebar
      ariaLabel="Agent sidebar"`, `    <TabbedRightSidebar
      scope="agent"
      ariaLabel="Agent sidebar"`],
      ],
    },
    {
      // Chats and channels: the same sidebar, opened by one button.
      file: 'src/features/chat/components/DirectMessageExperience.tsx',
      replace: [
        [`room.roomPanel === 'people' || room.roomPanel === 'pinned'`, `room.roomPanel === 'people' || room.roomPanel === 'pinned' || (room.roomPanel as string) === 'sidebar'`],
        [`return roomPanel === 'people' || roomPanel === 'pinned'`, `return roomPanel === 'people' || roomPanel === 'pinned' || roomPanel === 'sidebar'`],
      ],
    },
    {
      file: 'src/features/chat/components/DirectMessageExperience.parts.tsx',
      imports: `import { RoomSidebarToggle, RoomTabbedSidebar } from ${components}\n`,
      replace: [
        [
          `      <Button
        variant="ghost"
        type="button"
        onClick={() => setRoomPanel((current) => (current === 'people' ? null : 'people'))}
        aria-pressed={roomPanel === 'people'}
        title="People in this room"
        className={\`h-8 gap-1.5 rounded-md px-2 text-xs font-normal transition-colors hover:bg-(--surface-subtle) hover:text-(--foreground) \${
          roomPanel === 'people' ? 'bg-(--surface-subtle) text-(--foreground)' : 'text-(--muted)'
        }\`}
      >
        <UsersRound size={14} />
        {roster.participants.length}
      </Button>`,
          `      <RoomSidebarToggle roomPanel={roomPanel} setRoomPanel={setRoomPanel as never} peopleCount={roster.participants.length} />`,
        ],
        [
          `  if (roomPanel === 'people') {
    return (
      <RoomPeoplePanel`,
          `  if ((roomPanel as string) === 'sidebar') {
    return (
      <RoomTabbedSidebar
        onClose={onClosePanel}
        counts={{ people: roster.participants.length, pinned: pinnedSummaries.length }}
        people={<RoomPeoplePanel participants={roster.participants} agentsByPrincipal={ctx.directoryAgentsByPrincipal} presence={roster.presence} currentPrincipalId={roster.currentPrincipalId} onAddPeople={onAddPeople} onClose={onClosePanel} />}
        pinned={<RoomPinnedPanel pinned={pinnedSummaries} onJump={jumpToMessage} onUnpin={(messageId) => void togglePinned(messageId)} onClose={onClosePanel} />}
      />
    )
  }
  if (roomPanel === 'people') {
    return (
      <RoomPeoplePanel`,
        ],
      ],
    },
  ],
}
