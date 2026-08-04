import { redirect } from 'next/navigation'

export default function OutputsPage() {
  redirect('/app/files?view=outputs')
}
