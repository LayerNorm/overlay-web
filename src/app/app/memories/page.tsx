import { redirect } from 'next/navigation'

export default function MemoriesPage() {
  redirect('/app/settings?section=memories')
}
