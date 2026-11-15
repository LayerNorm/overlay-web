import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'

type Loader<P> = () => Promise<ComponentType<P> | { default: ComponentType<P> }>

/** next/dynamic on React.lazy. */
export default function dynamic<P extends object>(loader: Loader<P>, options?: { loading?: () => ReactNode; ssr?: boolean }) {
  const Lazy = lazy(async () => {
    const loaded = await loader()
    return 'default' in (loaded as object) ? (loaded as { default: ComponentType<P> }) : { default: loaded as ComponentType<P> }
  })
  return function Dynamic(props: P) {
    return <Suspense fallback={options?.loading ? options.loading() : null}><Lazy {...props} /></Suspense>
  }
}
