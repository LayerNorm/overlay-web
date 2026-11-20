// The agent working state: a live response ends with one orb and a sentence saying what the agent is doing right now
// (in place of the 24px Overlay mark), and the date line is the date alone, without rules on either side.
//   MOCKUP_FEATURE=agent-working-state node internal/plans/mockups/overlay-app/build.mjs
import { fileURLToPath } from 'node:url'

const components = JSON.stringify(fileURLToPath(new URL('./components.tsx', import.meta.url)))
const fixtures = JSON.stringify(fileURLToPath(new URL('./fixtures.ts', import.meta.url)))

export default {
  out: 'agent-working-state.html',
  title: 'Overlay | Agent working state mockup',
  patches: [
    {
      file: 'internal/plans/mockups/overlay-app/entry.tsx',
      imports: `import { installAgentWorkingFixtures } from ${fixtures}\n`,
      replace: [['installFixtures()\n', 'installFixtures()\ninstallAgentWorkingFixtures()\n']],
    },
    {
      // Agent threads, DMs and channels.
      file: 'src/features/chat/components/collaboration/RoomMessageItem.tsx',
      imports: `import { WorkingLine } from ${components}\n`,
      replace: [[
        '<ExchangeLoadingState presentation={responseLoadingPresentation(undefined, Boolean(message.streaming), message.blocks).loadingPresentation} />',
        '<WorkingLine presentation={responseLoadingPresentation(undefined, Boolean(message.streaming), message.blocks).loadingPresentation} blocks={message.blocks} />',
      ]],
    },
    {
      // Personal and workspace chats.
      file: 'packages/overlay-chat-react/src/components/transcript/ChatExchange.tsx',
      imports: `import { WorkingLine } from ${components}\n`,
      replace: [[
        '<ExchangeLoadingState presentation={loadingPresentation} />',
        '<WorkingLine presentation={loadingPresentation} blocks={assistantVisualBlocks} />',
      ]],
    },
    {
      // A running tool call shows the orb on its own row; agent tools also say who is asked and what.
      file: 'packages/overlay-chat-react/src/components/exchange/tool-call-rows.tsx',
      imports: `import { RunningAgentToolTitle, WorkingOrb, orbForTool } from ${components}\n`,
      replace: [
        [
          `        <TraceMark running={running} />
        {description ? (`,
          `        {running ? <WorkingOrb kind={orbForTool(block.name)} small /> : <TraceMark running={running} />}
        {running && RunningAgentToolTitle({ block }) ? <RunningAgentToolTitle block={block} /> : description ? (`,
        ],
        [
          `<TraceMark running={anyRunning && !anyErr} />`,
          `{anyRunning && !anyErr ? <WorkingOrb kind={orbForTool(tools.find((tool) => !TOOL_UI_DONE_STATES.has(tool.state))?.name ?? '')} small /> : <TraceMark running={false} />}`,
        ],
      ],
    },
    {
      // The pinned chiefs (workspace and personal) sit side by side as tiles at the top, like pinned conversations in
      // iMessage. A tile has no background at rest and is filled while it is open; one pinned chief is open at a time
      // and its threads show full width below the tiles.
      file: 'src/components/layout/AppSidebarAgentsPanel.tsx',
      replace: [
        [
          "isActive ? 'bg-(--surface-subtle)' : 'bg-(--surface-subtle)/55'",
          "isActive || isExpanded ? 'bg-(--surface-subtle)' : 'bg-transparent'",
        ],
        [
          `      <SidebarMenuItem data-agent-row={agent.id}>
        <div className="flex justify-center pb-2 pt-1">
          <div className="group/tile relative">`,
          `      <>
        <div data-pinned-chief={agent.id} className="row-start-1 min-w-0">
          <div className="group/tile relative">`,
        ],
        ['flex h-auto w-auto min-w-[116px] max-w-[200px] flex-col items-center', 'flex h-auto w-full flex-col items-center'],
        [
          `        {threads}
      </SidebarMenuItem>
    )
  }
  return (`,
          `        {threads ? <div className="col-span-full row-start-2">{threads}</div> : null}
      </>
    )
  }
  return (`,
        ],
        [
          // Opening one pinned chief closes the other.
          'if (!activityOnly) { toggleExpanded(agentId); return }',
          `if (!activityOnly) {
      const pinnedIds = sortedAgents.filter((agent) => isPinnedChief(agent, viewerPrincipalId)).map((agent) => agent.id)
      if (pinnedIds.includes(agentId) && !expanded.has(agentId)) {
        for (const id of pinnedIds) if (id !== agentId && expanded.has(id)) toggleExpanded(id)
      }
      toggleExpanded(agentId)
      return
    }`,
        ],
        [
          `        sortedAgents.map((agent) => {
          const isExpanded`,
          `        (() => { const renderAgent = (agent: WorkspaceAgentDirectoryItem) => {
          const isExpanded`,
        ],
        [
          `            </ActivityAgentRow>
          )
        })
      ) : (`,
          `            </ActivityAgentRow>
          )
        }
        const pinnedAgents = activityOnly ? [] : sortedAgents.filter((agent) => isPinnedChief(agent, viewerPrincipalId))
        const rest = sortedAgents.filter((agent) => !pinnedAgents.includes(agent))
        return [
          pinnedAgents.length ? (
            <SidebarMenuItem key="pinned-chiefs" data-pinned-chiefs className="grid gap-x-1.5 pb-2 pt-1"
              style={{ gridTemplateColumns: \`repeat(\${pinnedAgents.length}, minmax(0, 1fr))\` }}>
              {pinnedAgents.map(renderAgent)}
            </SidebarMenuItem>
          ) : null,
          ...rest.map(renderAgent),
        ] })()
      ) : (`,
        ],
      ],
    },
    {
      // Every block of a response is the same distance apart: the assignment row loses its top margin (the text
      // already ends with one) and gains it below, before the response controls.
      file: 'src/features/chat/components/AssignmentTrace.tsx',
      replace: [['<Trace className="mt-2 px-1 py-0.5" data-response-assignments>', '<Trace className="mb-2 px-1 py-0.5" data-response-assignments>']],
    },
    {
      // The date line in chats: the date alone.
      file: 'packages/overlay-chat-react/src/components/transcript/ChatTranscript.tsx',
      replace: [[
        `            className="flex items-center gap-3 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-light)"
            data-testid="chat-day-divider"
          >
            <span className="h-px flex-1 bg-(--border)" />
            <span>{dayLabel(exchange.user.createdAt!)}</span>
            <span className="h-px flex-1 bg-(--border)" />`,
        `            className="py-2 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-light)"
            data-testid="chat-day-divider"
          >
            <span>{dayLabel(exchange.user.createdAt!)}</span>`,
      ]],
    },
    {
      // The date line in agent threads, DMs and channels.
      file: 'src/features/chat/components/DirectMessageExperience.parts.tsx',
      replace: [[
        `<div className="flex items-center gap-3 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-light)">
                      <span className="h-px flex-1 bg-(--border)" />
                      <span>{roomDayLabel(message.createdAt)}</span>
                      <span className="h-px flex-1 bg-(--border)" />`,
        `<div className="py-1 text-center text-[10px] font-medium uppercase tracking-[0.12em] text-(--muted-light)">
                      <span>{roomDayLabel(message.createdAt)}</span>`,
      ]],
    },
  ],
}
