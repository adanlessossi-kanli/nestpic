'use client'

import { useEffect, useCallback } from 'react'
import type { FeedItem } from '@/lib/types/media'

interface VideoPlayerProps {
  item: FeedItem
  mediaUrl: string
  items: FeedItem[]
  onClose: () => void
  onNavigate: (item: FeedItem) => void
}

export default function VideoPlayer({ item, mediaUrl, items, onClose, onNavigate }: VideoPlayerProps) {
  const currentIndex = items.findIndex((i) => i.id === item.id)
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < items.length - 1

  const goPrev = useCallback(() => {
    if (hasPrev) onNavigate(items[currentIndex - 1])
  }, [hasPrev, currentIndex, items, onNavigate])

  const goNext = useCallback(() => {
    if (hasNext) onNavigate(items[currentIndex + 1])
  }, [hasNext, currentIndex, items, onNavigate])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose, goPrev, goNext])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label="Video player"
      onClick={onClose}
    >
      {/* Close button */}
      <button
        className="absolute top-4 right-4 text-white text-3xl leading-none hover:text-gray-300 focus:outline-none"
        onClick={onClose}
        aria-label="Close video player"
      >
        ×
      </button>

      {/* Prev button */}
      {hasPrev && (
        <button
          className="absolute left-4 text-white text-4xl leading-none hover:text-gray-300 focus:outline-none px-2"
          onClick={(e) => { e.stopPropagation(); goPrev() }}
          aria-label="Previous media"
        >
          ‹
        </button>
      )}

      {/* Video */}
      <div
        className="max-w-[90vw] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          src={mediaUrl}
          controls
          autoPlay
          className="max-w-[90vw] max-h-[85vh] rounded"
          aria-label={`Video by ${item.uploaderName}`}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>

      {/* Next button */}
      {hasNext && (
        <button
          className="absolute right-4 text-white text-4xl leading-none hover:text-gray-300 focus:outline-none px-2"
          onClick={(e) => { e.stopPropagation(); goNext() }}
          aria-label="Next media"
        >
          ›
        </button>
      )}

      {/* Caption */}
      <div className="absolute bottom-4 left-0 right-0 text-center text-white text-sm opacity-75 pointer-events-none">
        {item.uploaderName} · {new Date(item.uploadedAt).toLocaleDateString()}
      </div>
    </div>
  )
}
