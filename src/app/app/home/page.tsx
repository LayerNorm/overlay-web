import { redirect } from 'next/navigation'

/** Legacy demo-shell address. The canonical home page lives at `/home`. */
export default function AppHomeCompatPage() {
  redirect('/home')
}
