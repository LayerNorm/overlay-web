// Automations as threads (proposal): /app/automations becomes one composer with a schedule and an agent picker, and
// each automation is an ordinary thread whose first message is its instructions and whose runs arrive as messages.
//   MOCKUP_FEATURE=automation-threads node internal/plans/mockups/overlay-app/build.mjs
import { fileURLToPath } from 'node:url'

const components = JSON.stringify(fileURLToPath(new URL('./components.tsx', import.meta.url)))

export default {
  out: 'automation-threads.html',
  title: 'Overlay | Automation threads mockup',
  patches: [
    {
      // The Automations route renders the composer page, or an automation's thread.
      file: 'internal/plans/mockups/overlay-app/routes.tsx',
      imports: 'import { AutomationsPage } from ' + components + '\n',
      replace: [["if (pathname === '/app/automations') return <ChatRouteClient mode=\"automate\" />", "if (pathname === '/app/automations') return <AutomationsPage />"]],
    },
    {
      // Automations in the contextual panel, listed like threads.
      file: 'src/app/app/_components/AppShellSidebar.tsx',
      imports: 'import { AutomationThreadsPanel } from ' + components + '\n',
      replace: [['<AutomationsInlinePanel onNavigate={onNavigate} />', '<AutomationThreadsPanel onNavigate={onNavigate} />']],
    },
  ],
}
