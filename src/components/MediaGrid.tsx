'use client'

import { useState } from 'react'
import type { FeedItem } from '@/lib/types/media'

interface MediaGridProps {
  items: FeedItem[]
  nextCursor?: string | null
  onItemClick?: (item: FeedItem) => void
  currentUserId?: string
  onDelete?: (item: FeedItem) => void
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function Thumbnail({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <div className="absolute inset-0 bg-gray-200" />
  return (
      <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      onContextMenu={(e) => e.preventDefault()}
      draggable={false}
      className="absolute inset-0 w-full h-full object-cover"
    />
  )
}

export default function MediaGrid({ items, onItemClick, currentUserId, onDelete }: MediaGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((item) => (
        <div key={item.id} className="rounded overflow-hidden shadow-sm border border-gray-100">
          <button
            type="button"
            className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            onClick={() => onItemClick?.(item)}
            aria-label={`Open media by ${item.uploaderName}`}
          >
            <div className="relative w-full aspect-video bg-gray-200">
              {item.thumbnailUrl ? (
                <Thumbnail
                  src={item.thumbnailUrl}
                  alt={`Media by ${item.uploaderName}`}
                />
              ) : (
                <div className="absolute inset-0 bg-gray-200" />
              )}
            </div>
          </button>
          <div className="p-2 text-sm text-gray-700">
            <p className="font-medium">{item.uploaderName}</p>
            <p className="text-gray-500">{formatDate(item.uploadedAt)}</p>
            {currentUserId && item.uploaderId === currentUserId && onDelete && (
              <button
                type="button"
                onClick={() => onDelete(item)}
                className="text-sm text-red-600 hover:text-red-800 mt-1"
                aria-label={`Delete media by ${item.uploaderName}`}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
