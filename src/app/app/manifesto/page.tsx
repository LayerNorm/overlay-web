import { redirect } from 'next/navigation'

/** Legacy demo-shell address. The canonical manifesto lives at `/manifesto`. */
export default function AppManifestoCompatPage() {
  redirect('/manifesto')
}
