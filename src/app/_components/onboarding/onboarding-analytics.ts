import { withPosthog } from '@/components/providers/posthog-client'

export type OnboardingEvent =
  | 'onboarding_started'
  | 'onboarding_question_answered'
  | 'onboarding_subscription_connected'
  | 'onboarding_subscription_skipped'
  | 'onboarding_task_started'
  | 'onboarding_task_completed'
  | 'onboarding_plan_shown'
  | 'onboarding_plan_chosen'
  | 'onboarding_checklist_opened'
  | 'onboarding_checklist_item_clicked'

/** Funnel events for onboarding v2. Never includes answers or task text, only step ids and choices. */
export function trackOnboarding(event: OnboardingEvent, properties: Record<string, string | number | boolean>) {
  withPosthog((posthog) => posthog.capture(event, properties))
}
