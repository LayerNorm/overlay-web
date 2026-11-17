// Three proposals in one mockup, each placed inside the production component it would change:
//   1. Account avatars (and agent creatures) in the Direct Messages list, the People panel and the transcript.
//   2. A primary sidebar each person can arrange: pin pages from More, and a Customize dialog for order and placement.
//   3. Composer tags without the @, with avatars; link chips; and a hover card for both.
//   MOCKUP_FEATURE=people-sidebar-composer node internal/plans/mockups/overlay-app/build.mjs
import { fileURLToPath } from 'node:url'

const at = (file) => JSON.stringify(fileURLToPath(new URL(file, import.meta.url)))
const identity = at('./identity.tsx')
const sidebar = at('./sidebar.tsx')
const composer = at('./composer.tsx')
const photos = at('./photos.ts')

const feature = {
  out: 'people-sidebar-composer.html',
  title: 'Overlay | Avatars, customizable sidebar and composer chips mockup',
  patches: [
    {
      file: 'internal/plans/mockups/overlay-app/entry.tsx',
      imports: `import { mountComposerMockup } from ${composer}\n`,
      replace: [['installFixtures()\n', 'installFixtures()\nmountComposerMockup()\n']],
    },
    // Sample data: people have account photos (Jonah has none, to show the fallback).
    {
      file: 'internal/plans/mockups/overlay-app/fixtures/rooms.ts',
      imports: `import { PHOTOS } from ${photos}\n`,
      replace: [['email: person.email ?? undefined,', 'email: person.email ?? undefined,\n      photoUrl: PHOTOS[principalId],']],
    },
    {
      file: 'internal/plans/mockups/overlay-app/fixtures/data.ts',
      imports: `import { PHOTOS } from ${photos}\n`,
      replace: [["displayName: 'Mercedes Alvarez', photoUrl: null, displayNameOverride: null, hasCustomPhoto: false", "displayName: 'Mercedes Alvarez', photoUrl: PHOTOS.p_mercedes, displayNameOverride: null, hasCustomPhoto: true"]],
    },
    {
      file: 'internal/plans/mockups/overlay-app/fixtures/workspace.ts',
      imports: `import { PHOTOS } from ${photos}\n`,
      replace: [
        ["principalType: 'human', role: person.role, status: 'active'", "principalType: 'human', photoUrl: PHOTOS[person.principalId], role: person.role, status: 'active'"],
        ["displayName: 'Mercedes Alvarez', photoUrl: null, displayNameOverride: null, hasCustomPhoto: false", "displayName: 'Mercedes Alvarez', photoUrl: PHOTOS.p_mercedes, displayNameOverride: null, hasCustomPhoto: true"],
      ],
    },
    // 1. Avatars.
    {
      file: 'src/features/chat/components/ChatInlinePanel.tsx',
      imports: `import { DirectMessageAvatar } from ${identity}\n`,
      replace: [[
        'return <DirectMessageIcon participantTypes={chat.otherParticipantTypes} size={size} className={className} />',
        'return <DirectMessageAvatar chatId={chat._id} fallback={<DirectMessageIcon participantTypes={chat.otherParticipantTypes} size={size} className={className} />} />',
      ]],
    },
    {
      file: 'src/features/chat/components/collaboration/RoomSidePanels.tsx',
      imports: `import { PrincipalAvatar } from ${identity}\n`,
      replace: [[
        `<span className="flex h-8 w-8 items-center justify-center rounded-full bg-(--surface-muted) text-xs">
              {participant.displayName.slice(0, 1).toUpperCase()}
            </span>`,
        '<PrincipalAvatar principalId={participant.principalId} name={participant.displayName} size={32} />',
      ]],
    },
    {
      file: 'src/features/chat/components/collaboration/RoomMessageItem.tsx',
      imports: `import { mentionAvatar } from ${identity}\n`,
      replace: [['size={14}\n    />\n  ) : undefined', 'size={14}\n    />\n  ) : mentionAvatar(mention)']],
    },
    {
      file: 'src/features/chat/components/DirectMessageExperience.hooks.ts',
      replace: [["description: participant.principalType === 'agent' ? 'Agent' : 'Member',", "description: participant.principalType === 'agent' ? 'Agent' : 'Member',\n        photoUrl: participant.photoUrl,"]],
    },
    // 2. Customizable primary sidebar.
    {
      file: 'packages/overlay-shell-react/src/sidebar/DoubleSidebar.tsx',
      imports: `import { CustomizableMoreMenu, useSidebarLayout } from ${sidebar}\n`,
      replace: [
        [
          'const moreGroups = groupMoreItems(destinations, MORE_GROUPS)\n  const moreIds = new Set(moreGroups.flatMap((group) => group.items.map((item) => item.id)))',
          'const layout = useSidebarLayout(destinations)',
        ],
        [
          `{destinations.filter((item) => !moreIds.has(item.id)).map((item) => (
                <NavRow key={item.id} item={item} collapsed />
              ))}
              <MoreMenu groups={moreGroups} collapsed />`,
          `{layout.rail.map((item) => (
                <NavRow key={item.id} item={item} collapsed />
              ))}
              <CustomizableMoreMenu layout={layout} />`,
        ],
      ],
    },
    // 3. Composer chips.
    {
      file: 'src/features/chat/components/chat-interface/mention-input-dom.ts',
      imports: `import { mockChipClass, mockChipLead } from ${composer}\n`,
      replace: [
        [
          "chip.className =\n    'inline-flex items-center gap-1 mx-0.5 px-1.5 py-0.5 rounded-md bg-(--surface-muted) border border-(--border) text-xs font-medium text-(--foreground) select-none align-baseline'",
          'chip.className = mockChipClass(item)',
        ],
        ['label.textContent = `@${item.name}`\n  chip.append(symbol, label)', 'label.textContent = item.name\n  chip.append(mockChipLead(item) ?? symbol, label)'],
      ],
    },
  ],
}

export default feature
