export default function WorkLoading() {
  return <div className="h-full w-full animate-pulse p-6 motion-reduce:animate-none" aria-busy="true" aria-label="Loading work"><div className="h-5 w-24 rounded bg-(--surface-subtle)" /><div className="mt-8 h-10 rounded bg-(--surface-subtle)" /></div>
}
