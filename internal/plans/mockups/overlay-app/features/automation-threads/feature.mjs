import { fileURLToPath } from 'node:url'

const components = JSON.stringify(fileURLToPath(new URL('./components.tsx', import.meta.url)))
const fixtures = JSON.stringify(fileURLToPath(new URL('./fixtures.ts', import.meta.url)))

const feature = {
  out: 'automation-threads.html',
  title: 'Overlay | Scheduled threads',
  patches: [
    { file: 'internal/plans/mockups/overlay-app/entry.tsx', imports: `import { installAutomationFixtures } from ${fixtures}\n`, replace: [['installFixtures()\n', 'installFixtures()\ninstallAutomationFixtures()\n']] },
    { file: 'internal/plans/mockups/overlay-app/routes.tsx', imports: `import { AutomationThreadsPage } from ${components}\n`, replace: [[`if (pathname === '/app/automations') return <ChatRouteClient mode="automate" />`, `if (pathname === '/app/automations') return <AutomationThreadsPage />`]] },
  ],
}

export default feature
