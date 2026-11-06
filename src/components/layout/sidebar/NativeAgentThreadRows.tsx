'use client'

import type { ComponentProps } from 'react'
import { Button } from '@overlay/ui/primitives'
import { useNativeThreadClient, useNativeThreadList } from '@/components/providers/native-agent-threads'
import { AgentThreadRows } from '../AppSidebarAgentThreads'

type Props = ComponentProps<typeof AgentThreadRows>
export function AgentThreadRowsSource(props: Props) {
  const client = useNativeThreadClient()
  if (!client.enabled) return <AgentThreadRows {...props} />
  if (client.status !== 'ready') return <AgentThreadRows {...props} bundle={client.status === 'loading' ? 'loading' : 'error'} />
  return <NativeRows {...props} />
}

function NativeRows(props: Props) {
  const page = useNativeThreadList(props.agent.id)
  const automations = typeof props.bundle === 'object' ? props.bundle.automations : []
  return <>
    <AgentThreadRows {...props} bundle={page.loading ? 'loading' : { threads: page.rows, automations }} />
    {page.hasMore ? <Button variant="ghost" size="sm" disabled={page.loadingMore} onClick={page.loadMore}>Load more threads</Button> : null}
  </>
}
