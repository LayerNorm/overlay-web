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
