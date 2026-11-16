// Overlay Files on every computer (internal/plans/LOCAL_CLOUD_CONTINUITY_PLAN.md): folders from Overlay, GitHub,
// Google Drive and the Mac, picked per thread, with the web and desktop app side by side.
//   MOCKUP_FEATURE=files-on-computers node internal/plans/mockups/overlay-app/build.mjs
import { fileURLToPath } from 'node:url'

const components = JSON.stringify(fileURLToPath(new URL('./components.tsx', import.meta.url)))
const fixtures = JSON.stringify(fileURLToPath(new URL('./fixtures.ts', import.meta.url)))

export default {
  out: 'files-on-computers.html',
  title: 'Overlay | Files on every computer mockup',
  patches: [
    {
      // Source folders and the Atlas thread, plus the web/desktop window bar.
      file: 'internal/plans/mockups/overlay-app/entry.tsx',
      imports: `import { installFilesFixtures } from ${fixtures}\nimport { mountHostChrome } from ${components}\n`,
      replace: [['installFixtures()\n', 'installFixtures()\ninstallFilesFixtures()\nmountHostChrome()\n']],
    },
    {
      // Which computer runs the thread and which folder it works in, under the composer.
      file: 'src/features/chat/components/ChatComposer.tsx',
      imports: `import { FilesComposerFooter } from ${components}\n`,
      replace: [[
        `          {viewProps.mode === 'chat' ? (
            <p className="mt-2 text-center text-[11px] text-(--muted-light)">
              Overlay can make mistakes. Check important info.
            </p>
          ) : null}`,
        `          {viewProps.mode === 'chat' ? (
            <FilesComposerFooter fallback={null} />
          ) : null}`,
      ]],
    },
    {
      // Where each change went back to, in the transcript.
      file: 'src/features/chat/components/DirectMessageExperience.parts.tsx',
      imports: `import { FilesTranscriptRow } from ${components}\n`,
      replace: [[
        `                  <RoomMessage
                    message={message}
                    ctx={ctx}
                    grouped={grouped}
                    hideToolbar={guided}
                  />`,
        `                  <FilesTranscriptRow message={message}><RoomMessage
                    message={message}
                    ctx={ctx}
                    grouped={grouped}
                    hideToolbar={guided}
                  /></FilesTranscriptRow>`,
      ]],
    },
    {
      // What the agent's computer can reach, in the right panel's Details.
      file: 'src/features/agents/components/AgentSidebarDetails.tsx',
      imports: `import { FilesDetails, filesDetailsSummary } from ${components}\n`,
      replace: [[
        `      <DetailsDisclosure
        label="Instructions"`,
        `      {filesDetailsSummary(editor.agent?.id) ? (
        <DetailsDisclosure label="Files" summary={filesDetailsSummary(editor.agent?.id) ?? undefined}>
          <FilesDetails />
        </DetailsDisclosure>
      ) : null}
      <DetailsDisclosure
        label="Instructions"`,
      ]],
    },
    {
      // Source marks on folders in the Files sidebar tree.
      file: 'packages/overlay-modules-react/src/file-tree.tsx',
      imports: `import { SourceFolderIcon } from ${components}\n`,
      replace: [[
        `            ? open
              ? <FolderOpen aria-hidden />
              : <Folder aria-hidden />`,
        `            ? <SourceFolderIcon file={file} open={open} />`,
      ]],
    },
    {
      // Source marks in the Files list and card views.
      file: 'packages/overlay-modules-react/src/knowledge/file-views.tsx',
      imports: `import { SourceFolderIcon, sourceFolderLabel } from ${components}\n`,
      replace: [
        ['<Folder size={14} className="shrink-0 text-(--muted-light)" />', '<SourceFolderIcon file={node} size={14} className="text-(--muted-light)" />'],
        ['<Folder size={36} className="text-(--muted-light)" />', '<SourceFolderIcon file={folder} size={36} className="text-(--muted-light)" />'],
        ['<p className="mt-1 text-[10px] text-(--muted-light)">Folder</p>', '<p className="mt-1 text-[10px] text-(--muted-light)">{sourceFolderLabel(folder)}</p>'],
      ],
    },
    {
      // Add a folder from this Mac, GitHub or Google Drive, from the Files upload menu.
      file: 'packages/overlay-modules-react/src/knowledge/toolbar-menus.tsx',
      imports: `import { FilesSourceMenuItems } from ${components}\n`,
      replace: [[
        `              Upload Folder
            </Button>`,
        `              Upload Folder
            </Button>
            <FilesSourceMenuItems close={() => setUploadMenuOpen(false)} />`,
      ]],
    },
  ],
}
