import { redirect } from 'next/navigation'

export const instant = false

export default function AppPricingRedirect() {
  redirect('/pricing')
}
