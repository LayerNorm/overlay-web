import React from 'react'
import { createRoot } from 'react-dom/client'
import { ShellFixture } from './ShellFixture'
import { WorkFixture } from './WorkFixture'
import { AgentFixture } from './AgentFixture'

const params = new URLSearchParams(location.search)
const Fixture = ['work-list', 'task-detail', 'new-task'].includes(params.get('screen') ?? '')
  ? WorkFixture
  : ['agent-stream', 'agent-approval', 'agent-details', 'agent-editor'].includes(params.get('screen') ?? '')
    ? AgentFixture
  : ShellFixture
createRoot(document.getElementById('root')!).render(
  <Fixture
    initialScreen={params.get('screen') ?? 'boot'}
    dark={params.get('theme') === 'dark'}
    animate={params.get('animate') === 'true'}
    error={params.has('error')}
    onAction={(name) => {
      document.title = name
    }}
  />,
)
