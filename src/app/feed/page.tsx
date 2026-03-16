import { Suspense } from 'react'
import InfiniteScroll from '@/components/InfiniteScroll'
import FeedLoading from './loading'
import type { FeedItem } from '@/app/api/feed/route'

interface FeedResponse {
  items: FeedItem[]
  nextCursor: string | null
}

async function FeedContent() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  const res = await fetch(`${baseUrl}/api/feed`, { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to load feed')
  const json: FeedResponse = await res.json()
  return <InfiniteScroll initialItems={json.items} initialCursor={json.nextCursor} />
}

export default function FeedPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Family Feed</h1>
      <Suspense fallback={<FeedLoading />}>
        <FeedContent />
      </Suspense>
    </main>
  )
}
