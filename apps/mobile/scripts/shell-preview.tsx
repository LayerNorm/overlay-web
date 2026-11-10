import React from 'react'
import { createRoot } from 'react-dom/client'
import { ShellFixture } from './ShellFixture'

const params = new URLSearchParams(location.search)
createRoot(document.getElementById('root')!).render(
  <ShellFixture
    initialScreen={params.get('screen') ?? 'boot'}
    dark={params.get('theme') === 'dark'}
    animate={params.get('animate') === 'true'}
    error={params.has('error')}
    onAction={(name) => {
      document.title = name
    }}
  />,
)
