import React, { useState } from 'react'
import { View } from 'react-native'
import { BatteryFull, Signal, Wifi } from 'lucide-react-native'
import type { ChatModel } from '@overlay/app-core'
import { getTheme } from '../constants/theme'
import { T } from '../components/shell/primitives'
import {
  AgentDetailsView,
  AgentHeader,
  AgentThreadView,
  type AgentActions,
} from '../components/agents/AgentThreadViews'
import { AgentEditorView } from '../components/agents/AgentEditorView'
import type { AgentRecord } from '../services/agentThreadService'
import { encodeRunQuestions } from '../../../src/shared/agents/run-questions'
import type { RoomMessageRecord } from '../lib/roomMessages'
import { AGENT_TOOL_GROUPS } from '../lib/agentToolGroups'

export const agentFixtureRecord = {
  id: 'overlay',
  name: 'Overlay',
  isDefault: true,
  description:
    'Keeps work moving, connects the dots, and brings you in when it matters.',
  instructions: 'Help keep work moving.',
  modelId: 'Auto',
  allowedToolIds: Array(8).fill('tool'),
  visibility: 'workspace',
  canEdit: true,
} as AgentRecord

export function AgentFixture({
  initialScreen = 'agent-stream',
  dark = false,
  error = false,
  onAction = () => {},
}: {
  initialScreen?: string
  dark?: boolean
  animate?: boolean
  error?: boolean
  onAction?: (action: string) => void
}) {
  const theme = getTheme(dark)
  const [screen, setScreen] = useState(initialScreen)
  const [name, setName] = useState('Scout')
  const [description, setDescription] = useState(
    'Research and thoughtful recommendations.',
  )
  const [modelId, setModel] = useState('sonnet')
  const [enabled, setEnabled] = useState(
    new Set(['web_search', 'knowledge', 'computer']),
  )
  const [failure, setFailure] = useState('')
  const [stopped, setStopped] = useState(false)
  const [extra, setExtra] = useState<RoomMessageRecord[]>([])
  const run = async (action: string) => {
    if (error) throw new Error('Unable to save. Please try again.')
    onAction(action)
  }
  const actions: AgentActions = {
    approval: async (_, approved) => run(approved ? 'approved' : 'denied'),
    answer: async (_, text) => run('answered:' + text),
  }
  const approval = initialScreen === 'agent-approval'
  const messages: RoomMessageRecord[] = [
    {
      id: 'human',
      authorKind: 'human',
      content: 'Review our subscription pricing and recommend what to change.',
      createdAt: 1794342000000,
    },
    {
      id: 'reply',
      authorKind: 'agent',
      content: '',
      createdAt: 1794342120000,
      status: stopped || approval ? 'completed' : 'generating',
      parts: [
        {
          type: 'text',
          text: 'I compared our plans with the market and reviewed the last 30 days of feedback.\n\n',
        },
        {
          type: 'tool-invocation',
          data: {},
          ...{
            toolInvocation: {
              toolCallId: 'sources',
              toolName: 'Reviewed 4 sources',
              state: 'result',
              toolInput: {},
              toolOutput: 'Pricing, usage, feedback and competitors',
            },
          },
        },
        {
          type: 'tool-invocation',
          ...{
            toolInvocation: {
              toolCallId: 'pricing',
              toolName: 'Read pricing notes',
              state: 'result',
              toolInput: {},
              toolOutput: 'Current plan structure reviewed.',
            },
          },
        },
        ...(approval
          ? [
              {
                type: 'data-native-agent-approval',
                data: {
                  runId: 'run',
                  conversationId: 'pricing',
                  userId: 'viewer',
                  token: 'fixture-approval',
                  requestedAt: 1,
                  requests: [
                    {
                      approvalId: 'approval',
                      toolCallId: 'draft',
                      toolName: 'Approve pricing update',
                      input: {
                        action:
                          'Update the draft pricing page. Nothing will be published.',
                      },
                    },
                  ],
                },
              },
              {
                type: 'data-native-agent-input',
                data: {
                  runId: 'run',
                  conversationId: 'pricing',
                  userId: 'viewer',
                  token: 'fixture-input',
                  requestedAt: 2,
                  question: encodeRunQuestions([
                    {
                      prompt:
                        'Should existing customers keep their current pricing?',
                      choices: [
                        { label: 'Keep current pricing' },
                        { label: 'Review options' },
                      ],
                    },
                  ]),
                },
              },
            ]
          : [
              {
                type: 'text',
                text: '**Keep the entry plan simple.** Most customers need a clear starting point, not more tiers.\n\nI recommend keeping the current price and moving the usage details into a short comparison.\n\n',
              },
            ]),
      ],
    },
    ...extra,
  ]
  const scout = {
    ...agentFixtureRecord,
    id: 'scout',
    name,
    isDefault: false,
    avatarShape: 'cloud' as const,
    avatarColor: '#7d9c8c',
  }
  return (
    <View style={{ flex: 1, height: '100%', backgroundColor: theme.surface }}>
      <View
        style={{
          height: 40,
          paddingHorizontal: 26,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <T style={{ color: theme.foreground, fontWeight: '600', fontSize: 13 }}>
          9:41
        </T>
        <View style={{ flexDirection: 'row', gap: 5 }}>
          <Signal color={theme.foreground} size={13} />
          <Wifi color={theme.foreground} size={13} />
          <BatteryFull color={theme.foreground} size={17} />
        </View>
      </View>
      {screen === 'agent-editor' ? (
        <AgentEditorView
          theme={theme}
          dark={dark}
          agent={scout}
          name={name}
          description={description}
          modelId={modelId}
          models={
            [
              {
                id: 'sonnet',
                name: 'Claude Sonnet 4.6',
                provider: 'Anthropic',
              },
              { id: 'codex', name: 'GPT-5.4', provider: 'OpenAI' },
            ] as ChatModel[]
          }
          groups={AGENT_TOOL_GROUPS.filter((group) =>
            ['web_search', 'knowledge', 'computer'].includes(group.id),
          )}
          enabled={enabled}
          onName={setName}
          onDescription={setDescription}
          onModel={setModel}
          onToggle={(id) =>
            setEnabled((old) => {
              const next = new Set(old)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              return next
            })
          }
          onAdvanced={() => onAction('advanced')}
          onBack={() => setScreen('agent-stream')}
          onSave={() => {
            void run('saved:' + name).catch((reason) =>
              setFailure(reason.message),
            )
          }}
          error={failure}
          valid={Boolean(name.trim())}
        />
      ) : (
        <>
          <AgentHeader
            theme={theme}
            dark={dark}
            agent={agentFixtureRecord}
            title="Subscription pricing"
            onDrawer={() => onAction('drawer')}
            onDetails={() => setScreen('agent-details')}
            onOptions={() => onAction('options')}
          />
          <AgentThreadView
            theme={theme}
            dark={dark}
            agent={agentFixtureRecord}
            userId="viewer"
            messages={messages}
            actions={actions}
            onStop={async () => {
              await run('stop')
              setStopped(true)
            }}
            onSend={async (text, nonce) => {
              await run('send:' + text)
              setExtra((old) => [
                ...old,
                {
                  id: nonce,
                  authorKind: 'human',
                  content: text,
                  createdAt: 1794342220000,
                },
              ])
            }}
          />
          {screen === 'agent-details' ? (
            <View
              style={{
                position: 'absolute',
                inset: 0,
                justifyContent: 'flex-end',
                backgroundColor: theme.scrim,
              }}
            >
              <AgentDetailsView
                agent={agentFixtureRecord}
                computer={{ status: 'running' } as never}
                theme={theme}
                dark={dark}
                onClose={() => setScreen('agent-stream')}
                onEdit={() => setScreen('agent-editor')}
                onWeb={() => onAction('open-web')}
              />
            </View>
          ) : null}
        </>
      )}
      <View
        style={{
          height: 28,
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingBottom: 7,
        }}
      >
        <View
          style={{
            width: 134,
            height: 5,
            borderRadius: 4,
            backgroundColor: theme.foreground,
          }}
        />
      </View>
    </View>
  )
}
