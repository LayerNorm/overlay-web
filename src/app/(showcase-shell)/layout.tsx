import { AppShellLayout } from '@/app/_components/AppShellLayout'

// The reusable shell resolves a private session before selecting authenticated
// or showcase data. Navigations into this route group may wait for that boundary.
export const instant = false

export default function PublicShowcaseShellLayout({ children }: { children: React.ReactNode }) {
  return <AppShellLayout publicShowcase>{children}</AppShellLayout>
}
