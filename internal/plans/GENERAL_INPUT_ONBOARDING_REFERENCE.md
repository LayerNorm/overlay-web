# General Input onboarding reference

Source: 19 screenshots supplied by Divyansh on 2026-10-20, plus his description of the Get Started entry point. Image numbers below follow attachment order. Image 1 is Overlay; images 2 through 19 are General Input. This is a textual reference, not a verified live walkthrough or an implementation plan.

## Decisions and feedback to carry forward

- Retain Overlay's conversational onboarding. Borrow useful questions and sequencing, not the competitor's entire wizard.
- Add an account-level workspace directory, like Slack's workspace entry point. The user specifically wants this as the default landing for a new user, before entering a workspace.
- Remove the black border around the tour's highlighted navigation target. Keep the adjacent explanation card and use a quiet, borderless surface highlight. Preserve accessible keyboard focus as a separate interaction state.
- No production UI, routing, pricing, provider support, or permissions change is implemented by this document.

## Observed sequence, image by image

### Image 1: Overlay tour feedback, not competitor onboarding

- The Files navigation row is highlighted with a strong dark rounded border against a dimmed backdrop.
- The adjacent card shows **5 of 7**, **A place for shared context**, and: "Files brings together saved material, notes, and knowledge. Personal context stays separate from workspace context."
- Actions: **Skip tour**, **Back**, **Next**.
- User feedback: the black border is undesirable. This screenshot records the reported appearance, not a diagnosis of which CSS or focus state produced it.

### Image 2: Account home and workspace directory

Entry point: the user reports arriving here after clicking **Get Started**.

- General Input branding and an account avatar appear in the header.
- Greeting: **Good morning, Divyansh**.
- A **Profile** card shows the person's avatar, name and email, with **Edit** and **Log out** actions.
- A **My hosted workspaces** card has an information icon.
- Empty state: "You're not in a workspace yet. Invitations sent to [account email] show up above."
- Primary next action: **Create a new workspace**.

What it establishes: an account exists independently of any workspace. This screen is a place to find workspaces and invitations, rather than dropping a new user into an unexplained workspace. The supplied screenshot only shows the empty state, not a populated workspace list or invitation acceptance.

### Image 3: Create a workspace

- Heading: **Create your workspace**.
- Inputs: **Icon**, **Workspace name**, and **Workspace URL**.
- The example name is **Test** and its URL is displayed as `web.generalinput.com/test`.
- Actions: **Back to workspaces**, **Continue**.

What it establishes: the workspace has an explicit identity and address before the product asks about work. Later images use **Personal work**; the screenshots do not show how the name changed.

### Image 4: Optional website

- Question: **What's your website?**
- Explanation: "Your specialists read it to learn what Personal work does. Leave blank if there isn't one."
- Input placeholder: `example.com`.
- With the input empty, the action shown is **Skip**.

What it establishes: a low-effort source of business context with a stated purpose and an explicit escape hatch. Actual website fetching or extraction is not shown.

### Image 5: Team size

- Question: **How big is your team?**
- Choices, with letter badges A through F:
  - Just me
  - 2 to 10
  - 11 to 50
  - 51 to 200
  - 201 to 1,000
  - 1,000+
- Actions: **Back**, **Continue**. Continue is disabled in the screenshot with no selection.

What it establishes: whether this is individual or team work, without requiring a typed answer. Letter badges are visible; keyboard shortcut behavior is not verified.

### Image 6: Industry

- Question: **What industry is Personal work in?**
- Two-column choices with letter badges:
  - Software & technology
  - Consulting & agencies
  - Marketing & advertising
  - E-commerce & retail
  - Financial services
  - Healthcare
  - Education
  - Real estate & construction
  - Manufacturing
  - Logistics & transportation
  - Media & entertainment
  - Legal
  - Hospitality & travel
  - Energy & utilities
  - Nonprofit
  - Government
  - Other
- **Software & technology** is selected.
- Actions: **Back**, **Continue**.

What it establishes: the business domain for personalization. Only one selected option is shown; the screenshot alone does not prove selection rules.

### Image 7: Work functions

- Question: **What kind of work do you do?**
- Explanation: "Pick all that apply. Your specialists shape what they suggest around it."
- Choices:
  - Leadership
  - Engineering
  - Product
  - Design
  - Data & analytics
  - Marketing
  - Sales
  - Customer support
  - Operations
  - Finance
  - People & HR
  - Other
- The first six choices are selected.
- Action: **Continue**.

What it establishes: the person's responsibilities, distinct from their organization's industry. Multi-select is explicitly supported.

### Image 8: Connect work tools

- Heading: **Start by connecting**.
- Explanation: "The tools most teams start with. Everything else is in Integrations whenever you need it."
- Nine branded cards:
  - Gmail
  - Google Calendar
  - Google Drive
  - Google Sheets
  - Microsoft Outlook
  - Microsoft OneDrive
  - Slack
  - HubSpot
  - QuickBooks Online
- Action: **Skip for now**.

What it establishes: a curated starting set rather than an exhaustive catalog, with a clear path to connect more later.

### Image 9: Gmail permission review

This is a modal over the tool-connection screen, not a separate mandatory step.

- Heading: **Connect Gmail**.
- Explanation: "Choose which permissions to grant. You can change this later by reconnecting."
- Presets: **Everything**, **Read only**.
- Selection count: **5 of 5 selected**.
- Permission rows:
  1. See your primary Google Account email address. Tagged **REQUIRED**, **READ**.
  2. See your personal info, including any personal info you've made publicly available. Tagged **REQUIRED**, **READ**.
  3. View your email messages and settings. Tagged **READ**.
  4. Send email on your behalf. Tagged **WRITE**.
  5. Read, compose, send, and modify (but not permanently delete) email in your Gmail account. Tagged **WRITE**.
- Optional **Show scope names** checkbox.
- Actions: close, **Cancel**, **Connect**.

What it establishes: the difference between reading and acting is visible before consent. The image does not establish what scopes the backend actually requests or whether the connection succeeds.

### Image 10: Choose model access

- Heading: **Connect your intelligence**.
- Explanation: "Run your specialists on your Claude, ChatGPT, Gemini, Grok, or Muse subscription."
- Cards: **Claude**, **ChatGPT**, **Gemini**, **Grok**, **Muse**.
- Alternative action: **Use models provided by General Input**.

What it establishes: work-tool connections and model access are separate decisions. The quoted subscription claim is the competitor's copy, not a verified technical capability or a recommendation for Overlay to promise the same support.

### Image 11: Same model-access screen

- Another capture of the same heading, five cards, and hosted-model alternative.
- No additional onboarding step or meaningful new state is visible.

### Image 12: ChatGPT device authorization

This is a modal opened from the model-access screen.

- Heading: **Connect ChatGPT**.
- Instructions: "Open the sign-in page, enter this code, and approve access. This finishes on its own once you do."
- A device code is displayed with a copy control. The transient code is intentionally not transcribed here.
- Action: **Open sign-in page**.
- Status: **Waiting for you to approve...** with a loading indicator.
- Exit actions: close, **Cancel**.

What it establishes: a concrete, guided authorization task and a visible pending state. Completion and successful account linking are not shown.

### Image 13: Optional product introduction

- Heading: **Learn how to use General Input**.
- Explanation: "Three quick steps, about a minute. Then you'll hand your first task to a specialist."
- Three numbered concepts:
  1. Describe a task in your own words.
  2. Specialists are experts on particular tasks.
  3. Hand the busywork to your digital workforce.
- Actions: **Show me how**, **Skip to my first task**.

What it establishes: a short, bounded explanation of the product before first use, explicitly optional.

### Image 14: Lesson 1, describe a task

- Step label: **Step 1**.
- Heading: **Describe a task in your own words**.
- Explanation: "Start a new task and write what you need, the way you'd ask a coworker."
- Illustration: **New task** above a composer with a partially entered example, an attachment control, and a send button.
- Actions: **Back**, **Next**.

What it establishes: the interaction model through a concrete composer example. The still image does not establish animation behavior.

### Image 15: Lesson 2, explain specialists

- Step label: **Step 2**.
- Heading: **Specialists are experts on particular tasks**.
- Explanation: "They do the work for you and build what they need to do it well:"
  - "Workflows that run the steps on their own."
  - "Skills that remember how you like it done."
  - "Apps that show you the results."
- Illustration: one specialist linked to **Workflows**, **Apps**, and **Skills**.
- Actions: **Back**, **Next**.

What it establishes: a simple relationship between an agent and the reusable tools or outputs it produces. This is the competitor's product model, not necessarily Overlay's.

### Image 16: Lesson 3, explain the benefit

- Step label: **Step 3**.
- Heading: **Hand the busywork to your digital workforce**.
- Explanation: "Your specialists take repetitive work off your plate, so your time goes to the work you enjoy."
- Illustration: several specialists with workflow, app, and skill cards.
- Actions: **Back**, **Next**.

What it establishes: the outcome for the user after explaining the interaction and the agent concept.

### Image 17: Plan selection after a named specialist appears

- Workspace header: **Personal work**, with a back control and **Sign out**.
- Heading: **App Launcher is ready to start**.
- Explanation: "Every workspace starts on a plan. Your first month is 80% off, with the full month of credits."
- A seat counter shows **1 seat**, with decrement/increment controls.
- Two plan cards:
  - **Pro**: "Build AI with your team"; marked **Recommended**. $6 USD first month, then $30/month; 4,800 credits every month. **Start with Pro**.
  - **Max**: "More credits for heavier usage". $20 USD first month, then $100/month; 16,000 credits every month. **Start with Max**.
- Both display an **80% off** promotion, up to 50 members, monthly credits per seat, 25% off pay as you go, $0.0069 per credit beyond the allowance, and **Cancel anytime**.
- **Enterprise**: "For teams running at scale" and **Talk to sales**.

What it establishes: pricing is introduced around a concrete named specialist rather than before the product explanation. No free continuation is visible in the supplied pricing images. Payment, checkout completion, specialist creation, and task submission are not shown, so this is not proof of the exact gate or conversion sequence.

### Image 18: Lower portion of the same pricing screen

- Repeats the Pro, Max, and Enterprise details above.
- Adds: "Questions, or want a bigger discount? Book a call and we'll set one up."
- Actions: **Book a call with Jack**, **Enter a code**.

What it establishes: human-assisted sales and code redemption are available alongside self-service plan selection. This is not an additional onboarding step.

### Image 19: Product workspace and first-task entry

- Workspace switcher/header: **Personal work**.
- Main navigation: **Home**, **Workspace**, **New task**. New task is selected.
- **Specialists 2** section contains:
  - **App Launcher**, with a truncated recent message.
  - **Chief of Staff**, with a truncated greeting.
- Other sidebar sections: **Resources** with "No pinned or recent resources", **Data**, and **Library**.
- Center heading: **Where should we begin?**
- Composer placeholder: **How can I help you today?**
- Composer controls include attachment, **Auto** model choice, microphone, and send.
- Suggested starts:
  - **Summarize my unread emails**
  - **Alert me when**
  - **Send me a daily digest of**
- A **Specialist** control is visible above the main area; account controls remain at the bottom of the sidebar.

What it establishes: onboarding lands in the real work interface with concrete starting prompts. The screenshot does not show a submitted task, a completed result, or how the preceding payment screen was left.

## Condensed flow

Get Started (user-reported) -> account/workspace directory -> create workspace -> optional website -> team size -> industry -> work functions -> optional tool connections and permission review -> model-access choice and optional authorization -> optional three-part product lesson -> named-specialist pricing screen -> real workspace/task composer.

Images 11 and 18 repeat existing screens. Images 9 and 12 are modal branches. The transition that creates App Launcher and the transition through billing are not supplied; do not invent missing steps.

## What Overlay should learn

### 1. Put the account/workspace directory before workspace onboarding

User-requested direction: new users land on an account page showing their workspaces and invitations, with a clear **Create workspace** action. A returning user should also be able to reach that directory deliberately.

Proposal for review: new account -> directory -> create or accept invitation -> enter the selected workspace -> conversational onboarding where appropriate. Do not make an invited member create a redundant workspace. Returning-user routing and which onboarding steps apply to invited members still need design decisions.

### 2. Ask about organization context and personal responsibilities separately

Keep these inside the Overlay conversation, using compact inline choices when helpful:

- Organization context: workspace identity, optional website, whether the user works alone or with a team, and industry when it adds value.
- Personal context: responsibilities and recurring tasks they want help with.
- Avoid asking for information already supplied in free text. Offer an editable inferred answer or omit the redundant question.
- Keep workspace profile information distinct from owner-only Personal memories. A website or teammate invitation must not silently change memory visibility.

Do not simply append every competitor question to our existing flow. The value is better recommendations, not a longer questionnaire.

### 3. Explain each connection in terms of useful work

Use a small relevant tool set with a clear skip action. Make read versus write permissions understandable and default to the least access needed for the chosen task. Only offer a permission preset when the provider and actual OAuth flow can enforce it.

Do not treat a UI permission selection as authorization by itself. Provider consent and server-side enforcement still govern access. Live Composio connectivity remains a separate configuration and verification task.

### 4. Separate tools from model/runtime access

Mail, documents, calendars, and Slack provide work context. Claude Code/Codex connections provide supported external execution options. Overlay-hosted models are another path. Explain the distinction without requiring the user to understand architecture.

Do not broaden external-agent support to Gemini, Grok, Muse, or other offerings just because the competitor displays them. Retain the approved Claude Code/Codex scope and Overlay Free safety rules.

### 5. Teach the work loop before touring navigation

Their lesson explains what to do, what an agent does, and why it matters. Our navigation tour explains where things live. These serve different purposes.

Proposal: use a short, optional explanation or an actual first-task interaction to teach **describe work -> choose an employee -> review the result**. Keep the navigation tour lightweight and contextual, rather than adding another compulsory slideshow. Do not promise autonomous workflows, apps, or results beyond what Overlay actually supports.

### 6. End with a concrete task, not only completed setup

Personalized starter suggestions should draw on the user's stated work and successfully connected tools. If Gmail is not connected, do not imply that an unread-email summary can already run. Distinguish saving a starter task from executing it and delivering a result.

### 7. Treat pricing as a separate product decision

The competitor's screen connects a paid plan to a named specialist that is ready to start. That framing is worth studying. Its mandatory-looking gate, discounts, seat economics, and subscription claims should not be copied into Overlay without a separate billing decision.

### 8. Keep the visual restraint without copying the whole wizard

Useful patterns: one clear question, short explanation, generous spacing, a bounded set of choices, visible selection states, concise connect dialogs, and obvious skip/back actions.

For Overlay specifically: keep the chat, O-with-eyes brand introduction, centered inline setup panels, Personal memory default, and workspace reveal. Replace the reported heavy tour border with a quiet borderless highlight. Any new account page or material flow redesign should be mocked up for approval before implementation.

## Suggested next design checkpoint, not implemented

1. Mock up the account/workspace directory, including empty, populated, and invitation states.
2. Show how workspace creation hands off to our existing conversation.
3. Revise the chat questions to cover missing useful context without duplicating the user's answers.
4. Show a borderless tour-target treatment and a brief, optional work-loop explanation.
5. Review that sequence before changing production onboarding or billing.
