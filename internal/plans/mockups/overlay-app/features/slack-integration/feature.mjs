// Overlay in Slack (internal/plans/SLACK_WORKSPACE_OVERLAY_PLAN.md). Three proposals on the production shell:
// - Settings → Connected apps lists GitHub, Slack and MCP; each opens its own page (Settings › Connected apps › Slack).
//   MCP is today's page; Slack holds the install, who can ask Overlay, guests, Slack Connect and actions.
// - A Slack thread is an ordinary Workspace Overlay thread: listed under Overlay with a Slack mark, its header names the
//   channel with Open in Slack, and Slack participants without an Overlay account show by name.
// - A Slack DM thread is visible only to the person who sent it.
//   MOCKUP_FEATURE=slack-integration node internal/plans/mockups/overlay-app/build.mjs
import { fileURLToPath } from 'node:url'

const file = (name) => JSON.stringify(fileURLToPath(new URL('./' + name, import.meta.url)))

export default {
  out: 'slack-integration.html',
  title: 'Overlay | Slack integration mockup',
  patches: [
    {
      file: 'internal/plans/mockups/overlay-app/entry.tsx',
      imports: `import { installSlackFixtures } from ${file('fixtures.ts')}\n`,
      replace: [['installFixtures()\n', 'installFixtures()\ninstallSlackFixtures()\n']],
    },
    {
      file: 'src/app/app/settings/page.tsx',
      imports: `import { ConnectedAppsHub, connectedAppHeader } from ${file('components.tsx')}\n`,
      replace: [
        ["if (section === 'connected-apps') return <ConnectedAppsSettings />", "if (section === 'connected-apps') return <ConnectedAppsHub />"],
        ['activeLabel={sectionLabel}', "activeLabel={connectedAppHeader(section, searchParams?.get('app'))?.label ?? sectionLabel}\n      parents={connectedAppHeader(section, searchParams?.get('app'))?.parents}"],
      ],
    },
    {
      file: 'packages/overlay-modules-react/src/settings/page-shell.tsx',
      replace: [
        ['  actions?: ReactNode\n', '  actions?: ReactNode\n  parents?: { label: string; href: string }[]\n'],
        ['  actions,\n  fullBleed', '  actions,\n  parents = [],\n  fullBleed'],
        ['breadcrumbs={[{ label: title }]}', 'breadcrumbs={[{ label: title }, ...parents]}'],
      ],
    },
    {
      file: 'src/features/settings/components/ConnectedAppsSettings.tsx',
      replace: [['text-(--foreground)">Connected apps</h2>', 'text-(--foreground)">Use Overlay in other AI apps</h2>']],
    },
    {
      file: 'src/components/layout/AppSidebarAgentThreads.tsx',
      imports: `import { SlackMark as ProposedSlackMark } from ${file('components.tsx')}\nimport { slackOrigin as proposedSlackOrigin } from ${file('origin.ts')}\n`,
      replace: [[
        '              {isPrivate ? <CloudOff',
        '              {proposedSlackOrigin(thread.conversationId) ? <ProposedSlackMark size={11} className="shrink-0 text-(--muted-light)" /> : null}\n              {isPrivate ? <CloudOff',
      ]],
    },
    {
      file: 'src/features/chat/components/DirectMessageExperience.tsx',
      imports: `import { SlackOriginSubtitle, SlackThreadNote } from ${file('components.tsx')}\nimport { slackOrigin as proposedSlackOrigin } from ${file('origin.ts')}\n`,
      replace: [
        ["subtitle={guided ? 'Your chief of staff'", "subtitle={proposedSlackOrigin(conversationId) ? <SlackOriginSubtitle conversationId={conversationId} /> : guided ? 'Your chief of staff'"],
        ['                {guided?.footer}\n', '                {guided?.footer}\n                <SlackThreadNote conversationId={conversationId} />\n'],
      ],
    },
  ],
}
