import { redirect } from 'next/navigation'

export default function PricingPage() {
  redirect('/app/pricing?showcase=1')
}
