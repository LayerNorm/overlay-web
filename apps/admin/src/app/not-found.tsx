import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <p className="text-sm text-(--muted)">404 — this admin page does not exist.</p>
        <Link href="/" className="mt-3 inline-block text-sm text-(--foreground) underline">Back to the console</Link>
      </div>
    </div>
  )
}
