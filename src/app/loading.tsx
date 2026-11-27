import { AppBootLoader } from '@/components/layout/AppBootLoader'

/** `/` resolves the session behind the boot loader; matching it here keeps entry to one loading state. */
export default function Loading() {
  return <AppBootLoader />
}
