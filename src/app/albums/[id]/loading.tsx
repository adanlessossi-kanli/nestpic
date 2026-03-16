export default function AlbumLoading() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded overflow-hidden shadow-sm border border-gray-100">
          <div className="w-full aspect-video bg-gray-200 animate-pulse" />
          <div className="p-2 space-y-2">
            <div className="h-4 bg-gray-200 animate-pulse rounded w-1/2" />
            <div className="h-3 bg-gray-200 animate-pulse rounded w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}
