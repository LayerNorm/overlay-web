// Proposed onboarding: three questions, a free first task, then Subscribe and Slack after the first result.
// The real OnboardingShell and OnboardingConversation run against an in-page fake of the onboarding API, so the
// shell, chat, choices and composer are production. Proposed changes:
// - Only name and help areas before the first task (onboardingProfileSteps → ['name', 'daily']).
// - The first task starts free: the payment card at the task step becomes Start task with no card.
// - Setup ends in the Workspace Overlay chat (as on this branch); the task runs there and its result arrives.
// - After the result, Overlay asks to subscribe ($8/month, production copy), then offers Slack and Gmail.
//   MOCKUP_FEATURE=free-first-task node internal/plans/mockups/overlay-app/build.mjs
import { fileURLToPath } from 'node:url'

const file = (name) => JSON.stringify(fileURLToPath(new URL('./' + name, import.meta.url)))

export default {
  out: 'free-first-task.html',
  title: 'Overlay | Free first task onboarding mockup',
  patches: [
    {
      file: 'internal/plans/mockups/overlay-app/entry.tsx',
      imports: `import { installFreeFirstTaskFixtures } from ${file('fixtures.ts')}\n`,
      replace: [['installFixtures()\n', 'installFixtures()\ninstallFreeFirstTaskFixtures()\n']],
    },
    {
      file: 'internal/plans/mockups/overlay-app/fixtures/data.ts',
      replace: [["  route('GET', /^\\/api\\/v1\\/onboarding\\/session$/, () => ({ completed: true, session: null }))\n", '']],
    },
    {
      file: 'src/shared/onboarding/session.ts',
      replace: [["  if (session.flowVersion === 3) return session.member ? ['name', 'about', 'daily'] : ['name', 'about', 'team', 'daily']", "  if (session.flowVersion === 3) return ['name', 'daily']"]],
    },
    {
      file: 'src/app/_components/onboarding/OnboardingConversation.tsx',
      imports: `import { FreeFirstTask, FREE_FIRST_TASK_HINT } from ${file('components.tsx')}\n`,
      replace: [
        ['        ? <OnboardingPayment\n', '        ? <FreeFirstTask\n'],
        ['<p className="mt-3 text-xs text-muted-foreground">{nameHint}</p>', '<p className="mt-3 text-xs text-muted-foreground">{FREE_FIRST_TASK_HINT}</p>'],
      ],
    },
    {
      file: 'src/features/chat/components/DirectMessageExperience.tsx',
      imports: `import { FirstResultFollowUp } from ${file('components.tsx')}\n`,
      replace: [['                {guided?.footer}\n', '                {guided?.footer}\n                <FirstResultFollowUp conversationId={conversationId} />\n']],
    },
  ],
}
