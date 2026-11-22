# Creature-first mobile experience

Status: phases 1–6 implemented on native-shell and checked in the iOS 26 simulator (light and dark). Not yet tested: notification permission grant on a real device, iPad layout, Android.

Goal: make Overlay mobile feel playful and personal by putting the agent
creatures (shape + color + eyes, already used for agent identity) at the
center of first run, chat and agent management. Inspired by the interaction
patterns of consumer agent apps; all art, names and copy are Overlay's own.

## Patterns adopted

| Pattern | Overlay expression |
| --- | --- |
| Welcome screen with floating characters | Sign-in shows drifting Overlay creatures around the wordmark and "Your AI Chief of Staff." with one pill button. |
| One idea per onboarding page, big centered title, full-width pill "Next" | 3 intro pages + notification permission page, then the default Overlay agent chat. |
| Characters with labelled roles | "Hand off work" page shows example agents (Chief of Staff uses the Overlay mark). |
| Agent identity in a header capsule | Conversation header shows avatar + name in a capsule; tapping opens the agent profile. |
| Agent profile with large avatar and grouped rows | Native page sheet: large creature, name, Edit, Files, Computer, thread actions. |
| Visual agent creator | Sheet with live creature preview, name field, shape grid and color swatches; creates the agent and opens its chat. |

## Phases

| # | Phase | State |
| --- | --- | --- |
| 1 | Shared creature field + pill button | Implemented |
| 2 | Sign-in welcome | Implemented |
| 3 | Onboarding flow, wired to first sign-in (`needsOnboarding`) | Implemented |
| 4 | Create-agent sheet from Agents "+" | Implemented |
| 5 | Agent profile sheet + capsule header | Implemented |
| 6 | Chat polish (composer, replies, new-chat suggestions), Chats inbox sections, Agents grid, creature empty states | Implemented |

## Not adopted (and why)

- "How did you hear about us" survey: no backend field yet (see growth analytics plan); add when the web records it.
- Gray bubbles for agent replies: agent output keeps the web transcript format (tool rows, markdown) for parity.
- Per-agent notification toggle: no per-agent notification preference exists server-side.

## Known gaps

- Personal chat transcripts render through the shared web transcript, so their per-message action row and date dividers stay at web parity.
- The iOS status bar text stays dark when the system switches to dark mode while the app is open (seen in the simulator; not yet diagnosed).
- Markdown lists keep zero bottom margin because the native markdown view under-measures it and clips following text.
