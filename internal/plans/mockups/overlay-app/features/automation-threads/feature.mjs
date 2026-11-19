// Automations as threads (proposal): an automation is an ordinary chat that gets a message on a schedule. The
// Automations route is the production chat; the composer gains a Schedule and an Agent picker beside its model control,
// and an automation's chat docks an Automation details panel where agent threads dock theirs.
//   MOCKUP_FEATURE=automation-threads node internal/plans/mockups/overlay-app/build.mjs
import { fileURLToPath } from 'node:url'

const components = JSON.stringify(fileURLToPath(new URL('./components.tsx', import.meta.url)))
const fixtures = JSON.stringify(fileURLToPath(new URL('./fixtures.ts', import.meta.url)))

export default {
  out: 'automation-threads.html',
  title: 'Overlay | Automation threads mockup',
  patches: [
    {
      // Automation chats answer the personal chat queries.
      file: 'internal/plans/mockups/overlay-app/entry.tsx',
      imports: 'import { installAutomationFixtures } from ' + fixtures + '\n',
      replace: [['installFixtures()\n', 'installFixtures()\ninstallAutomationFixtures()\n']],
    },
    {
      // The Automations route is the production chat.
      file: 'internal/plans/mockups/overlay-app/routes.tsx',
      replace: [["if (pathname === '/app/automations') return <ChatRouteClient mode=\"automate\" />", "if (pathname === '/app/automations') return <ChatRouteClient />"]],
    },
    {
      // Automations in the contextual panel, listed like threads.
      file: 'src/app/app/_components/AppShellSidebar.tsx',
      imports: 'import { AutomationThreadsPanel } from ' + components + '\n',
      replace: [['<AutomationsInlinePanel onNavigate={onNavigate} />', '<AutomationThreadsPanel onNavigate={onNavigate} />']],
    },
    {
      // Schedule and Agent beside the model control; sending creates the automation or follows up in its chat.
      file: 'src/features/chat/components/ChatComposer.tsx',
      imports: 'import { AutomationComposerPickers, useAutomationComposer } from ' + components + '\n',
      replace: [
        ['function ComposerInputCard(props: ComposerViewProps & { disabledSend: boolean }) {\n', 'function ComposerInputCard(props: ComposerViewProps & { disabledSend: boolean }) {\n  props = useAutomationComposer(props)\n'],
        ['</PromptInputTools>\n', '</PromptInputTools>\n      <AutomationComposerPickers />\n'],
      ],
    },
    {
      // The Automation details panel and its header toggle.
      file: 'src/features/chat/components/ChatExperienceView.tsx',
      imports: 'import { useAutomationShell } from ' + components + '\n',
      replace: [['  const modelControlsInComposer = Boolean(composerProps)', '  ;({ shell, headerProps } = useAutomationShell(main.activeChatId, shell, headerProps))\n  const modelControlsInComposer = Boolean(composerProps)']],
    },
  ],
}
