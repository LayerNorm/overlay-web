import React, { useEffect, useState } from 'react'
import { Stack, useRouter } from 'expo-router'
import {
  Button,
  Form,
  HStack,
  Host,
  Image as Symbol,
  Picker,
  RNHostView,
  Section,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui'
import { font, lineLimit, pickerStyle, tag, tint } from '@expo/ui/swift-ui/modifiers'
import { agentsForCreatorScope } from '../../../src/shared/agents/last-agent-by-workspace'
import { chiefRoleLabel, isPinnedChief, pinChiefs } from '../../../src/shared/agents/chief-identity'
import { useNativeDataReady } from '../../contexts/ConvexAuthProvider'
import { useTheme } from '../../hooks/useTheme'
import { subscribeAgents, type ShellAgent } from '../../services/shellService'
import { AgentAvatar } from '../shell/AgentAvatar'
import { secondary } from './WorkForms'

type Scope = 'workspace' | 'personal'
type Directory = { agents: ShellAgent[]; viewerPrincipalId: string | null }

export function WorkOrganization({
  workspaceId,
  workspaceName,
  initialScope,
}: {
  workspaceId: string | null
  workspaceName?: string
  initialScope: Scope
}) {
  const { theme, isDark } = useTheme()
  const ready = useNativeDataReady()
  const router = useRouter()
  const [scope, setScope] = useState(initialScope)
  const [directory, setDirectory] = useState<Directory | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!workspaceId || !ready) return
    return subscribeAgents(
      workspaceId,
      (agents, viewerPrincipalId) => {
        setDirectory({ agents, viewerPrincipalId })
        setFailed(false)
      },
      () => setFailed(true),
    )
  }, [workspaceId, ready, attempt])

  const viewer = directory?.viewerPrincipalId
  const agents = pinChiefs(
    agentsForCreatorScope(
      (directory?.agents ?? []).filter((agent) => !agent.archivedAt),
      viewer,
      scope,
    ),
    viewer,
  )
  const chief = agents.find(
    (agent) => agent.agentRole === (scope === 'workspace' ? 'workspace_chief' : 'personal_chief'),
  )
  const owner = (agent: ShellAgent) =>
    agent.agentRole === 'workspace_chief'
      ? workspaceName || 'Workspace'
      : (agent.createdByDisplayName || 'Member') +
        (agent.createdByPrincipalId === viewer ? ' · You' : '')

  function agentRow(agent: ShellAgent) {
    return (
      <Button key={agent.id} onPress={() => router.push({ pathname: '/agent/[id]', params: { id: agent.id } })}>
        <HStack spacing={12}>
          <RNHostView matchContents>
            <AgentAvatar agent={agent} foreground={theme.foreground} dark={isDark} size={34} />
          </RNHostView>
          <VStack alignment="leading" spacing={2}>
            <Text modifiers={[lineLimit(1)]}>{agent.name}</Text>
            <Text modifiers={[secondary, font({ size: 13 }), lineLimit(2)]}>
              {`${chiefRoleLabel(agent)} · ${owner(agent)}`}
            </Text>
          </VStack>
          <Spacer />
          {isPinnedChief(agent, viewer) ? <Symbol systemName="pin" size={13} modifiers={[secondary]} /> : null}
          <Symbol systemName="chevron.right" size={13} modifiers={[secondary]} />
        </HStack>
      </Button>
    )
  }
  const others = agents.filter(({ id }) => id !== chief?.id)

  return (
    <>
      <Stack.Screen options={{ title: 'Organization', headerLargeTitle: false }} />
      <Host style={{ flex: 1 }} colorScheme={isDark ? 'dark' : 'light'}>
        <Form modifiers={[tint(theme.foreground as string)]}>
          <Section>
            <Picker selection={scope} onSelectionChange={(value: Scope) => setScope(value)} modifiers={[pickerStyle('segmented')]}>
              <Text modifiers={[tag('workspace')]}>Workspace</Text>
              <Text modifiers={[tag('personal')]}>Personal</Text>
            </Picker>
          </Section>
          {failed ? (
            <Section footer={<Text>Could not load the organization.</Text>}>
              <Button label="Try again" onPress={() => { setFailed(false); setAttempt(attempt + 1) }} />
            </Section>
          ) : !workspaceId ? (
            <Section footer={<Text>Choose a workspace to view its organization.</Text>}>{null}</Section>
          ) : !ready || !directory ? (
            <Section footer={<Text>Loading…</Text>}>{null}</Section>
          ) : (
            <>
              <Section title="Chief of staff" footer={chief ? undefined : <Text>No chief of staff is available in this scope.</Text>}>
                {chief ? agentRow(chief) : null}
              </Section>
              {others.length ? <Section title="Reports to the chief">{others.map(agentRow)}</Section> : null}
            </>
          )}
        </Form>
      </Host>
    </>
  )
}
