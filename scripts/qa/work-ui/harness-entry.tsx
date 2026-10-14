import React from 'react'
import { createRoot } from 'react-dom/client'
import { installFakeWorkApi } from './fake-work-api'

// The API client binds `fetch` when it is created, so the fake has to be in place before the app modules load.
installFakeWorkApi()
document.documentElement.dataset.theme = new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light'
void import('../../../src/features/work/components/WorkPage').then(({ WorkPage }) => {
  createRoot(document.getElementById('root')!).render(
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <WorkPage />
    </div>,
  )
})
