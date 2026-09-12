import { redirect } from 'next/navigation'

/** Legacy demo-shell address. Canonical pricing lives at `/pricing`. */
export default function AppPricingCompatPage() {
  redirect('/pricing')
}
