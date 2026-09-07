import { redirect } from 'next/navigation'
import { ROOT_APP_DESTINATION } from '@/shared/auth/root-entry'

export default function AppPage() {
  redirect(ROOT_APP_DESTINATION)
}
