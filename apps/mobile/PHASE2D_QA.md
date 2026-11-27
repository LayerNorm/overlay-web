# Phase 2d Chats QA

## Data and scope

- Personal creation and transcript reads use the existing generated-type-checked `chat.personal.create` and `chat.personal.getMessages` adapters. Durable turns now use `chat.personal.submit` before HTTP orchestration. Execution state subscribes to `chat.personal.getExecution`, replacing HTTP polling.
- HTTP remains for stream orchestration, stop, approvals, uploads and image/video generation. Temporary chats do not create or submit durable Convex turns.
- Model records come from the web bootstrap catalog; ordering imports the portable web `CHAT_MODEL_QUALITY_PRIORITY`. Favorites are device-local and user-scoped. Queued toggles preserve stored favorites even before the initial read finishes.
- Failed sends retain drafts and stable turn IDs. Workspace/conversation ownership checks discard stale results.
- Room actions keep the existing Convex handlers. Edit/delete are own-message only. Reply in thread focuses the current composer when already in a thread rather than creating nested threads. Reporting and thread following remain available.

## Commands

```sh
npm run check
node --test scripts/*.test.cjs
npx eslint components/chat/ChatScreen.tsx components/chat/Composer.tsx components/chat/MessageBubble.tsx components/chat/RoomMessageItem.tsx components/chat/RoomScreen.tsx components/chat/ChatViews.tsx components/chat/ModelPicker.tsx components/chat/ResponseMark.tsx components/chat/RoomMessageActions.tsx components/ui/AppChrome.tsx hooks/useFavoriteModels.ts lib/chatModels.ts lib/personalStream.ts lib/roomMessages.ts services/aiService.ts services/chatStorage.ts services/chatTypes.ts services/personalChatService.ts scripts/ChatFixture.tsx scripts/native-shell-preview.tsx scripts/phase2d.test.cjs
npx expo export --platform android --source-maps --no-bytecode
npx expo export --platform ios --source-maps --no-bytecode
```

The existing 63 regression tests passed. The ten Chats tests passed after correcting lightweight renderer mocks. Targeted ESLint exits successfully with three warnings: mention sequence ref cleanup, an existing room image alt warning and an existing unused participant import.

## Android evidence

Artifacts: `/home/ubuntu/mobile-drift-audit/phase2d-chats/`.

- `comparison-{personal-new,personal-stream,model-picker,channel-room,message-thread}-{light,dark}.png`: native Android beside approved mockup; both contact sheets are `comparison-contact-{light,dark}.png`.
- `native-*.png` and matching XML: all five requested surfaces in both themes.
- `native-settled-light.png`: stop removes the one active mark, with unfinished Markdown withheld while active.
- `native-favorites-light.png`, `native-model-empty-light.png`: favorite toggle, all three mode tabs, empty search and pinned Auto.
- `native-other-message-actions-light.png`: native long press and other-message ownership restrictions.
- `native-eye-motion-*.png`, `native-reduced-motion-*.png`: pixel diffs constrain movement to the center of the response mark; reduced motion produces identical frames.
- `native-captures.log`, `interactions.log`, `eyes.log`, export/check/lint logs and capture scripts provide reproducible evidence.

Visual comparison found translucent legacy sheets leaking transcript text through the picker/action sheet. Chats now opt into opaque sheets with a tall model layout; other callers retain their existing glass-sheet behavior. Native interaction checks cover stop, modes, favorites, empty search, long press and ownership. Reaction shortcuts use thin Lucide icons; persisted room reactions remain actual reaction content.

Intentional differences from the static mockups: current catalog models and provider quality order, live context/title breadcrumbs and existing production controls, real ownership-based message alignment, extra Copy/Reply actions, and Android rather than an iPhone frame/home indicator.

## Live acceptance still required

Fixtures and mocked adapters do not establish signed-in backend persistence. On an authorized test workspace, create and reopen a personal chat, send/retry/stop a real turn, test approval state and image/video generation, and switch workspaces during a send. In a channel verify `Message #<name>`, reactions, thread replies, pin/save, copy, own edits/deletes and thread following survive reopening. Confirm policy denial remains a calm app-level state. iOS was exported but not executed on a device.
