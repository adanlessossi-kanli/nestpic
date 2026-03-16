'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import MediaGrid from '@/components/MediaGrid'
import type { FeedItem } from '@/app/api/feed/route'

interface AlbumInfiniteScrollProps {
  initialItems: FeedItem[]
  initialCursor: string | null
  albumId: string
}

export default function AlbumInfiniteScroll({ initialItems, initialCursor, albumId }: AlbumInfiniteScrollProps) {
  const [items, setItems] = useState<FeedItem[]>(initialItems)
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [loading, setLoading] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return
    setLoading(true)
    try {
      const url = `/api/albums/${albumId}?cursor=${encodeURIComponent(cursor)}`
      const res = await fetch(url)
      if (!res.ok) return
      const data: { items: FeedItem[]; nextCursor: string | null } = await res.json()
      setItems((prev) => [...prev, ...data.items])
      setCursor(data.nextCursor)
    } finally {
      setLoading(false)
    }
  }, [cursor, loading, albumId])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !cursor) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore()
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [cursor, loadMore])

  return (
    <div>
      <MediaGrid items={items} />
      <div ref={sentinelRef} className="h-4" />
      {loading && (
        <div className="flex justify-center py-4">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  )
}
