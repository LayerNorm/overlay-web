import { redirect } from 'next/navigation'

export default function HomeRedirect() {
  redirect('/app/home?showcase=1')
}
