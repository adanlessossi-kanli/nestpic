import Image from 'next/image'
import type { FeedItem } from '@/app/api/feed/route'

interface MediaGridProps {
  items: FeedItem[]
  nextCursor?: string | null
  onItemClick?: (item: FeedItem) => void
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function MediaGrid({ items, onItemClick }: MediaGridProps) {
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
                <Image
                  src={item.thumbnailUrl}
                  alt={`Media by ${item.uploaderName}`}
                  fill
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                />
              ) : (
                <div className="absolute inset-0 bg-gray-200" />
              )}
            </div>
          </button>
          <div className="p-2 text-sm text-gray-700">
            <p className="font-medium">{item.uploaderName}</p>
            <p className="text-gray-500">{formatDate(item.uploadedAt)}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
