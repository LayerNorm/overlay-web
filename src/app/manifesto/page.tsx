import { redirect } from 'next/navigation'

export default function ManifestoRedirect() {
  redirect('/app/manifesto?showcase=1')
}
