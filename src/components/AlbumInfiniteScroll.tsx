'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import MediaGrid from '@/components/MediaGrid'
import Lightbox from '@/components/Lightbox'
import VideoPlayer from '@/components/VideoPlayer'
import type { FeedItem } from '@/app/api/feed/route'

interface AlbumInfiniteScrollProps {
  initialItems: FeedItem[]
  initialCursor: string | null
  albumId: string
}

const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/x-msvideo'])

export default function AlbumInfiniteScroll({ initialItems, initialCursor, albumId }: AlbumInfiniteScrollProps) {
  const [items, setItems] = useState<FeedItem[]>(initialItems)
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [loading, setLoading] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Media viewer state
  const [activeItem, setActiveItem] = useState<FeedItem | null>(null)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [mediaLoading, setMediaLoading] = useState(false)

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

  const openItem = useCallback(async (item: FeedItem) => {
    setActiveItem(item)
    setMediaUrl(null)
    setMediaLoading(true)
    try {
      const res = await fetch(`/api/media/${item.id}`)
      if (res.ok) {
        const data: { mediaUrl: string } = await res.json()
        setMediaUrl(data.mediaUrl)
      }
    } finally {
      setMediaLoading(false)
    }
  }, [])

  const closeViewer = useCallback(() => {
    setActiveItem(null)
    setMediaUrl(null)
  }, [])

  const navigateTo = useCallback((item: FeedItem) => {
    openItem(item)
  }, [openItem])

  const isVideo = activeItem ? VIDEO_TYPES.has(activeItem.contentType) : false

  return (
    <div>
      <MediaGrid items={items} onItemClick={openItem} />
      <div ref={sentinelRef} className="h-4" />
      {loading && (
        <div className="flex justify-center py-4">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Media viewer overlay */}
      {activeItem && mediaUrl && !isVideo && (
        <Lightbox
          item={activeItem}
          mediaUrl={mediaUrl}
          items={items}
          onClose={closeViewer}
          onNavigate={navigateTo}
        />
      )}
      {activeItem && mediaUrl && isVideo && (
        <VideoPlayer
          item={activeItem}
          mediaUrl={mediaUrl}
          items={items}
          onClose={closeViewer}
          onNavigate={navigateTo}
        />
      )}
      {activeItem && mediaLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  )
}
