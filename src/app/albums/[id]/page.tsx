import { Suspense } from 'react'
import AlbumInfiniteScroll from '@/components/AlbumInfiniteScroll'
import AlbumLoading from '@/app/albums/[id]/loading'
import type { FeedItem } from '@/app/api/feed/route'
import { getValidSession } from '@/lib/auth/session'

interface AlbumResponse {
  items: FeedItem[]
  nextCursor: string | null
}

async function AlbumContent({ id }: { id: string }) {
  const session = await getValidSession()
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  const res = await fetch(`${baseUrl}/api/albums/${id}`, { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to load album')
  const json: AlbumResponse = await res.json()
  return <AlbumInfiniteScroll initialItems={json.items} initialCursor={json.nextCursor} albumId={id} currentUserId={session?.userId} />
}

export default async function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <main className="container mx-auto px-4 py-8">
      <a href="/albums" className="text-blue-600 hover:underline text-sm mb-4 inline-block">
        ← Back to Albums
      </a>
      <h1 className="text-2xl font-bold mb-6">Album</h1>
      <Suspense fallback={<AlbumLoading />}>
        <AlbumContent id={id} />
      </Suspense>
    </main>
  )
}
