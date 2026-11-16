import { notFound } from 'next/navigation'
import { VideoDay04Fixture } from '@/features/work/dev/VideoDay04Fixture'

export const instant = false;

export default async function VideoDay04FixturePage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <VideoDay04Fixture />
}
