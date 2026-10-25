# Workspace entry and reusable questionnaires

## Production implementation in PR #291

The account directory uses authenticated account-scoped routes before mounting the workspace shell. Empty accounts are not assigned a Personal workspace automatically. Creation is freeform and idempotent; invitation lookup uses the signed session email. New owner sessions collect responsibilities, team context, optional website context and recurring work. Invited members skip workspace-owner setup. Existing sessions retain their original sequence.

Onboarding was redesigned after review (`onboarding-redesign-mockup.html`, approved): a scripted flow with no model calls, controls in the message text column under each question, one-tap single choices, multi-select with Continue, name extraction from conversational answers, one combined tools step with brand logos, and natural user replies. Onboarding no longer uses `QuestionnaireSuggestions` or composer-synced choices; main chat and agent questionnaires still do.

`QuestionnaireSuggestions` wraps the official shadcn questionnaire primitives. Suggestions edit and focus the host composer, with single or multiple choices and custom text. Submitted onboarding answers remain server-persisted and revision-checked; unfinished profile drafts are scoped to the user, workspace, run and step in browser session storage. Back is available before side-effecting setup, not an undo for employees, connections, memories or invitations. Those operations retain explicit confirmations. Website context is not fetched during setup.

Main chat and agent conversations use the existing `present_generated_ui` tool's bounded `questionnaire` kind. The persisted question contains stable choice IDs and label snapshots. Its answer is an ordinary editable chat message, not structured approval or permission to execute anything. Existing connected-agent permission and elicitation requests retain their separate authenticated, durable resumption protocol. The structured `request_user_input` response contract below is a future extension, not a native paused-tool protocol implemented by this PR.

Browser QA for production code is recorded separately in the PR. The screenshots and simulation checks below describe the approved mockups, not production verification.

## Separate deliverables

- `workspace-mockup.html`: account directory, existing workspaces, invitation acceptance, and workspace creation. Workspace names are freeform, with no multiple-choice presets. Creation returns to the workspace directory, without starting onboarding.
- `onboarding-mockup.html`: includes the same workspace entry flow, followed by the orb introduction, conversational questions, employee confirmation, simulated work-tool and external-agent connections, Personal context review, invitation review, Personal starter-task review, workspace reveal, and optional six-stop tour ending with “Happy working.” Main chat and agent questionnaire examples are also included.

Both files are self-contained. The bottom-left selector in the complete mockup starts at **Full journey** and can jump directly to later stages with sample context. Restart resets the selected scenario. The older `workspace-questionnaire-mockup.html` is the previous combined design iteration, not the current deliverable.

Attachment compatibility: the viewer permits JavaScript but blocks native form submissions. Both current mockups use explicit button and keyboard handlers instead of form submission, including workspace creation and questionnaire answers. Workspace validation is inline. The complete journey was reproduced and retested inside an iframe with only `sandbox="allow-scripts"`, without form or same-origin permission.

Suggested answers populate and focus the composer without submitting. Multiple choices combine into an editable draft. Users can add context, deselect choices without losing their custom text, and press Enter to send exactly the draft they see. Back restores the draft; clearing it removes stale selections. This behavior also applies to the main-chat and agent questionnaire examples. Workspace names remain freeform.

Verified in Chrome: complete owner journey, workspace-only creation and invitation acceptance, shorter invited-member onboarding, solo-user invitation skip, chat and agent questionnaire submission, Back preserving answers, reset, connection states, email validation, and the complete tour. Desktop, mobile, and dark-mode views were rendered and inspected. No production code or deployment configuration changed.

## Visual revision

The first visual direction was rejected. The current mockup returns to the previously approved conversation layout: unboxed assistant messages, compact suggested-answer chips, and custom text in the bottom chat composer. Employee recommendations remain compact cards. The account directory uses a simple centered workspace list. The large questionnaire panel, redundant explanatory copy, prominent step counter, and floating center toolbar have been removed. The response semantics below remain the same; submission now uses the composer send button rather than a form-card Continue button. Desktop, mobile, and dark agent views were rendered and checked again, including the new composer interactions.

Design checkpoint for PR #291: https://github.com/LayerNorm/overlay-web/pull/291

Open either current deliverable directly in a browser. Both include their font and branding. All responses and workspace actions are simulated in browser memory. Reload or Restart resets the scenario. No API calls, live model generation, credentials, integrations, or persistent writes are involved.

## Try the mockup

- **New account:** empty workspace directory, workspace creation, metallic orb introduction, conversational questions, first-task review, workspace reveal, optional tour.
- **Existing workspaces:** a populated directory and direct entry into a workspace.
- **Workspace invitation:** join an existing workspace without creating another. The shorter conversation skips owner setup questions.
- **Main chat questionnaire:** a three-question planning request in the Chats surface.
- **Agent questionnaire:** the same request and controls in an employee conversation on Agents.
- The theme button switches light/dark. On mobile, the revealed shell uses a drawer. Tour targets have only a background highlight, not a border. Keyboard focus remains visible separately.

## Questionnaire behavior in this design

The official [shadcn Radix Questionnaire](https://ui.shadcn.com/docs/components/radix/questionnaire) exists and supports single choice, multiple choice, freeform input, explicit skip, progress, previous/next, conditional items, and restored answers. Its host owns persistence, transport, branching, and cancellation. The standalone HTML mirrors that interaction model; it is not a React installation of the component.

- Every conversational question has suggestions and a custom text field.
- Single-choice questions use one suggested answer **or** custom text. Typing clears the radio selection; choosing an option clears the custom answer. This avoids contradictory answers.
- Multiple-choice questions accept any combination of options **plus** custom details. Custom text alone also works.
- Continue validates required questions. Optional questions have an explicit Skip, distinct from an empty answer.
- Back retains draft answers. Review lets the user revise answers before the simulated handoff.
- Enter submits custom text, Shift+Enter adds a newline. IME composition does not submit.
- Solo users skip invitations. Invited members skip workspace ownership decisions.
- Existing account identity supplies name suggestions; arbitrary personal details are not invented.

The mockup uses deterministic recommendations based on selected work categories. It does not claim to understand arbitrary free text, infer every already-answered question, or fetch a website. Production should omit questions already answered confidently and offer an editable summary instead. Avoid treating uncertain inference as confirmed context.

## Same-PR implementation direction, after design approval

1. **Account entry:** add an account-scoped workspace directory outside the workspace shell. Read real memberships and pending invitations. Workspace creation uses the existing access checks and mutation; invitation acceptance enters the invited workspace and does not create a replacement. Keep the directory reachable from the workspace switcher. Resume onboarding on the selected workspace rather than resetting it.
2. **Shared UI:** add the official Radix Questionnaire to `@overlay/ui`, adapted to existing tokens and exports. Preserve its semantic controls, validation, keyboard behavior, controlled active item, and default answers. Do not create separate copies for onboarding, chat, and agents.
3. **Shared transcript adapter:** put the host-facing wrapper in `@overlay/chat-react`. Both main chat and agent room messages already pass through `AssistantVisualBlocks`. Keep unanswered questions visible instead of collapsing them into the completed work group. Completed responses render as compact readable summaries.
4. **Typed request:** define a schema-validated questionnaire part in `@overlay/chat-core`, with a stable request ID and revision. The existing `generated-ui` part and renderer are integration points to evaluate, not permission to accept arbitrary model-authored HTML. Use only supported question types and bounded, plain-text labels.
5. **Native tool:** expose a proposed `request_user_input` tool through the existing `prepareActTooling` pipeline used by `buildWorkspaceAgentTooling`, not an onboarding-only side channel. Pause in a durable waiting-for-input state. Return a structured response to the originating tool call, correlated by request and conversation. Do not hold a server request open indefinitely. Honor existing tool grants and add the required compatibility mapping if a tool group gains a new ID.
6. **Connected agents:** the bridge protocol already has `elicitation_requested`, `requestedSchema`, and `elicitation_response`; remote transcripts already distinguish `waiting_for_input` from permission approval. Adapt the supported schema subset into the same questionnaire. Do not invent a second approval protocol or promise support for unsupported JSON Schema features.
7. **Onboarding adapter:** replace open-text-only prompts with the shared component while retaining revision-checked persistence, optimistic transcript reconciliation, Overlay Free safeguards, deterministic fallback, and Personal-only memories. Keep explicit confirmations for invitations, tool connections, employee creation, and the first task.
8. **Tour:** remove the current target inset border in `onboarding.module.css`. Preserve geometry, drawer positioning, and the distinct keyboard-focus indicator.

### Proposed data boundary, not yet a production contract

```ts
type Question = {
  id: string
  prompt: string
  mode: 'single' | 'multiple'
  required: boolean
  choices: Array<{ id: string; label: string; description?: string }>
  customInput?: { label: string; placeholder?: string }
}

type QuestionnaireResponse = {
  requestId: string
  revision: number
  status: 'submitted' | 'cancelled'
  answers: Record<string, {
    selectedIds: string[]
    customText: string
    skipped: boolean
  }>
}
```

The mockup's expandable response preview uses human-readable labels for inspection. Production must serialize stable option IDs, not labels. Preserve the rendered label snapshot for transcript history. A changed label must not reinterpret a saved answer.

Server validation must bind responses to the authenticated participant, workspace, conversation, original request, and revision. Reject unknown IDs, duplicate submissions, stale revisions, too many selections for a single-choice question, oversized text, and missing required answers. Make a repeated accepted submission idempotent. Cancellation, optional skip, and connection failure are separate outcomes. Restore drafts and the active question on refresh; after submission, edits should create an explicit revised response rather than silently rewriting a tool result an agent already consumed.

Answers clarify intent; they do not grant permissions, override approvals, connect accounts, send invitations, or authorize execution. Imported memories remain Personal. Choosing a tool in a questionnaire is not an OAuth connection. Distinguish task saved, work started, and result ready using actual server state.

## Implementation acceptance gates

- One component behaves identically in onboarding, main chat, and agent messages.
- Required/optional, single/multiple, custom-only, choices-plus-custom, back, skip, cancellation, keyboard navigation, and refresh/resume work.
- A native agent and a supported connected-agent elicitation can suspend, receive the correct structured response once, and resume. A questionnaire in another conversation cannot consume it.
- Personal memory visibility is unchanged, and an invited member cannot perform owner setup actions.
- Desktop and mobile light/dark rendering, long answers, and target-adjacent borderless tour are verified in the isolated preview.
- Focused tests cover serialization and stale/duplicate/unauthorized responses. Use the repo's existing type, lint, boundary, and preview gates for production changes.

## Scope of this delivery

Only the mockup and this design note are new. Production routes, packages, agent tools, deployment settings, and PR #291 implementation are unchanged by this design pass. The questionnaire capability can be included in that PR after this design checkpoint; no separate product feature or backend contract has been silently shipped.

## Prototype verification

Verified the rendered HTML in Chrome at desktop (1440 by 960) and mobile (390 by 844) sizes, including light and dark states. Exercised workspace creation and the orb handoff, required-answer validation, custom single choice, multiple selections plus custom text, Enter/Shift+Enter, Back with retained answers, optional skip, task review, structured chat response preview, agent questionnaire, existing workspace entry, and scenario reset. The invited-member path has seven questions; the solo path has ten and omits invitations. All six tour stops were exercised on desktop and mobile with borderless targets. No browser page errors were observed during the main run. Production integration, durable resume, actual OAuth, invitations, model calls, and tool execution are intentionally not part of this prototype.
