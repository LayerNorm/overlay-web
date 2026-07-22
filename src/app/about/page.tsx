import { redirect } from 'next/navigation'

export default function AboutRedirect() {
  redirect('/app/home?showcase=1')
}
