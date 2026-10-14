import React from 'react'
import { createRoot } from 'react-dom/client'
import { installFakeWorkApi } from './fake-work-api'

// The API client binds `fetch` when it is created, so the fake has to be in place before the app modules load.
installFakeWorkApi()
const params = new URLSearchParams(window.location.search)
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light'

async function main() {
  const root = createRoot(document.getElementById('root')!)
  if (params.get('surface') === 'search') {
    // The command palette (Cmd+K), to check that tasks can be found from it.
    const { GlobalSearchDialog } = await import('../../../src/components/layout/GlobalSearchDialog')
    root.render(<GlobalSearchDialog open onClose={() => undefined} onNewChat={() => undefined} workspaceId={null} />)
    return
  }
  const { WorkPage } = await import('../../../src/features/work/components/WorkPage')
  root.render(
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <WorkPage fallback={<div data-testid="work-fallback">Loading work</div>} />
    </div>,
  )
}
void main()
