// Local and cloud continuity (internal/plans/LOCAL_CLOUD_CONTINUITY_PLAN.md, Phases 2–4), placed into the real app.
//   MOCKUP_FEATURE=local-cloud-continuity node internal/plans/mockups/overlay-app/build.mjs
import { fileURLToPath } from 'node:url'

const components = JSON.stringify(fileURLToPath(new URL('./components.tsx', import.meta.url)))
const fixtures = JSON.stringify(fileURLToPath(new URL('./fixtures.ts', import.meta.url)))

export default {
  out: 'local-cloud-continuity.html',
  title: 'Overlay | Local and cloud continuity mockup',
  patches: [
    {
      // Feature fixtures: the two Atlas project threads.
      file: 'internal/plans/mockups/overlay-app/entry.tsx',
      imports: `import { installContinuityFixtures } from ${fixtures}\n`,
      replace: [['installFixtures()\n', 'installFixtures()\ninstallContinuityFixtures()\n']],
    },
    {
      // Phase 2/3: where the thread runs, its project and the handoff action, under the composer.
      file: 'src/features/chat/components/ChatComposer.tsx',
      imports: `import { ContinuityComposerFooter } from ${components}\n`,
      replace: [[
        `          {viewProps.mode === 'chat' ? (
            <p className="mt-2 text-center text-[11px] text-(--muted-light)">
              Overlay can make mistakes. Check important info.
            </p>
          ) : null}`,
        `          {viewProps.mode === 'chat' ? (
            <ContinuityComposerFooter fallback={
            <p className="mt-2 text-center text-[11px] text-(--muted-light)">
              Overlay can make mistakes. Check important info.
            </p>} />
          ) : null}`,
      ]],
    },
    {
      // Phase 3/4: handoff dividers and delegated tasks in the transcript.
      file: 'src/features/chat/components/DirectMessageExperience.parts.tsx',
      imports: `import { ContinuityTranscriptRow } from ${components}\n`,
      replace: [[
        `                  <RoomMessage
                    message={message}
                    ctx={ctx}
                    grouped={grouped}
                    hideToolbar={guided}
                  />`,
        `                  <ContinuityTranscriptRow message={message}><RoomMessage
                    message={message}
                    ctx={ctx}
                    grouped={grouped}
                    hideToolbar={guided}
                  /></ContinuityTranscriptRow>`,
      ]],
    },
    {
      // Phase 2: the agent's project and context package in the right panel's Details.
      file: 'src/features/agents/components/AgentSidebarDetails.tsx',
      imports: `import { ContinuityProjectDetails, continuityProjectSummary } from ${components}\n`,
      replace: [[
        `      <DetailsDisclosure
        label="Instructions"`,
        `      {continuityProjectSummary(editor.agent?.id) ? (
        <DetailsDisclosure label="Project" summary={continuityProjectSummary(editor.agent?.id) ?? undefined}>
          <ContinuityProjectDetails />
        </DetailsDisclosure>
      ) : null}
      <DetailsDisclosure
        label="Instructions"`,
      ]],
    },
  ],
}
