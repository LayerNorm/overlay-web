// Tabbed thread panel: everything beside an agent thread (progress, computer, changes, files, terminal, agent
// settings and opened files) as tabs in one docked panel, with a "+" launcher, instead of a fixed hero and three pills.
//   MOCKUP_FEATURE=tabbed-right-panel node internal/plans/mockups/overlay-app/build.mjs
import { fileURLToPath } from 'node:url'

const components = JSON.stringify(fileURLToPath(new URL('./components.tsx', import.meta.url)))
const store = JSON.stringify(fileURLToPath(new URL('./store.ts', import.meta.url)))

const feature = {
  out: 'tabbed-right-panel.html',
  title: 'Overlay | Tabbed thread panel mockup',
  patches: [
    {
      // The agent panel's production Details, Library and Computer content becomes three of the panel's tabs.
      file: 'src/features/agents/components/AgentRightSidebar.tsx',
      imports: `import { WorkspacePanel } from ${components}\nimport { openTab } from ${store}\n`,
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
