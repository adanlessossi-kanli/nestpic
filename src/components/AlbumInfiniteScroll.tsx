'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import MediaGrid from '@/components/MediaGrid'
import Lightbox from '@/components/Lightbox'
import VideoPlayer from '@/components/VideoPlayer'
import UploadForm from '@/components/UploadForm'
import type { FeedItem } from '@/lib/types/media'

interface AlbumInfiniteScrollProps {
  initialItems: FeedItem[]
  initialCursor: string | null
  albumId: string
  currentUserId?: string
}

const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/x-msvideo'])

export default function AlbumInfiniteScroll({ initialItems, initialCursor, albumId, currentUserId }: AlbumInfiniteScrollProps) {
  const [items, setItems] = useState<FeedItem[]>(initialItems)
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [loading, setLoading] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Media viewer state
  const [activeItem, setActiveItem] = useState<FeedItem | null>(null)
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [mediaLoading, setMediaLoading] = useState(false)

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<FeedItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [showUpload, setShowUpload] = useState(false)

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

  const handleDeleteRequest = useCallback((item: FeedItem) => {
    setDeleteTarget(item)
  }, [])

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/media/${deleteTarget.id}`, { method: 'DELETE' })
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.id !== deleteTarget.id))
        setDeleteTarget(null)
      }
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget])

  const handleDeleteCancel = useCallback(() => {
    setDeleteTarget(null)
  }, [])

  const isVideo = activeItem ? VIDEO_TYPES.has(activeItem.contentType) : false

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={() => setShowUpload(true)}
          className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700"
        >
          Upload
        </button>
      </div>
      <MediaGrid items={items} onItemClick={openItem} currentUserId={currentUserId} onDelete={handleDeleteRequest} />
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

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <div role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h2 id="delete-dialog-title" className="text-lg font-semibold mb-2">Delete media?</h2>
            <p className="text-gray-600 mb-4 text-sm">This will permanently remove the photo or video and cannot be undone.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={handleDeleteCancel} disabled={deleting} className="px-4 py-2 text-sm rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
              <button onClick={handleDeleteConfirm} disabled={deleting} className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload modal */}
      {showUpload && (
        <UploadForm
          onClose={() => setShowUpload(false)}
          onSuccess={(item) => {
            setItems((prev) => [item, ...prev])
            setShowUpload(false)
          }}
          albumId={albumId}
        />
      )}
    </div>
  )
}
