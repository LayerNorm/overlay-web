// Tabbed thread panel: everything beside an agent thread (progress, computer, changes, files, terminal, agent
// settings and opened files) as tabs in one docked panel, with a "+" launcher, instead of a fixed hero and three pills.
//   MOCKUP_FEATURE=tabbed-right-panel node internal/plans/mockups/overlay-app/build.mjs
import { fileURLToPath } from 'node:url'

const components = JSON.stringify(fileURLToPath(new URL('./components.tsx', import.meta.url)))
const store = JSON.stringify(fileURLToPath(new URL('./store.ts', import.meta.url)))
const pinnedAgent = JSON.stringify(fileURLToPath(new URL('./pinned-agent.tsx', import.meta.url)))

const feature = {
  out: 'tabbed-right-panel.html',
  title: 'Overlay | Tabbed thread panel mockup',
  patches: [
    {
      // The agent panel's production Details, Library and Computer content becomes three of the panel's tabs.
      file: 'src/features/agents/components/AgentRightSidebar.tsx',
      imports: `import { WorkspacePanel } from ${components}\nimport { openTab } from ${store}\nimport { AgentCreature } from '@/components/orb/Creature'\n`,
      replace: [
        ["content: selectedTab === 'details' ? (", 'content: true ? ('],
        ["content: selectedTab === 'library' ? <AgentLibraryTab", 'content: true ? <AgentLibraryTab'],
        ["content: selectedTab === 'computer' ? (", 'content: true ? ('],
        ['  if (previewFileId) {\n    return (', '  if (false) {\n    return ('],
        [
          '    <RightSidebar\n      ariaLabel="Agent sidebar"',
          `    <WorkspacePanel
      conversationId={conversationId}
      agentName={agentName}
      avatar={agent ? <AgentCreature agent={agent} isDefault={usesOverlayMark(agent)} size={48} /> : null}
      agent={tabs[0].content}
      files={tabs[1].content}
      computer={tabs[2].content}
      previewFileId={previewFileId}
      onPreviewFileChange={onPreviewFileChange}
      renderFile={(fileId, close) => <AgentLibraryPreview fileId={fileId} onBack={() => { close(); openTab('files') }} onClose={close} />}`,
        ],
      ],
    },
    {
      // The pinned chief of staff (Overlay) becomes a tile above the other agents, in Personal and Workspace.
      file: 'src/components/layout/AppSidebarAgentsPanel.tsx',
      imports: `import { PinnedAgentTile } from ${pinnedAgent}\n`,
      replace: [
        ['    openingAgentId,\n    openError,\n', '    openingAgentId,\n    openAgentById,\n    openError,\n'],
        [
          '          const isExpanded = activityOnly ? !activityCollapsed.has(agent.id) : expanded.has(agent.id)\n',
          `          const isExpanded = activityOnly ? !activityCollapsed.has(agent.id) : expanded.has(agent.id)
          if (!activityOnly && isPinnedChief(agent, viewerPrincipalId)) {
            return (
              <PinnedAgentTile
                key={agent.id}
                agent={agent}
                active={activeAgentId === agent.id}
                expanded={isExpanded}
                bundle={bundles[agent.id] ?? 'loading'}
                activeConversationId={activeConversationId}
                creating={creatingThreadFor === agent.id}
                onOpen={() => void openAgentById(agent)}
                onCreateThread={() => void createThread(agent)}
                onOpenThread={openThread}
                onOpenAutomation={openAutomation}
                onArchiveThread={(target, conversationId, archived) => { void archiveThread(target, conversationId, archived) }}
              />
            )
          }
`,
        ],
      ],
    },
    {
      // The panel is wider by default, drag-resizable, and can expand over most of the thread.
      file: 'src/features/chat/components/DirectMessageExperience.tsx',
      imports: `import { resizePanel, usePanelWidth } from ${store}\n`,
      replace: [
        [
          '  const panels = useRoomPanels({ renderAttachmentViewer: AttachmentViewer })\n',
          '  const panels = useRoomPanels({ renderAttachmentViewer: AttachmentViewer })\n  const workspacePanelWidth = usePanelWidth()\n',
        ],
        [
          "externalRightPanel ? (externalRightPanelWidth ?? 'lg') : 380}",
          'externalRightPanel ? workspacePanelWidth : 380}',
        ],
        [
          'onRightPanelResize={panels.shellRightPanel ? panels.shellRightPanelResize : undefined}',
          'onRightPanelResize={panels.shellRightPanel ? panels.shellRightPanelResize : externalRightPanel ? resizePanel : undefined}',
        ],
      ],
    },
  ],
}

export default feature
